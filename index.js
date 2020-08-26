'use strict';

const BbPromise = require('bluebird');
const _ = require('lodash');
const Fse = require('fs-extra');
const Path = require('path');
const ChildProcess = require('child_process');
const zipper = require('zip-local');
const upath = require('upath');
const readlineSync = require('readline-sync');

BbPromise.promisifyAll(Fse);


class PkgPyFuncs {

  fetchConfig(){
    if (!this.serverless.service.custom){
      this.error("No serverless custom configurations are defined")
    }

    const config = this.serverless.service.custom.pkgPyFuncs

    if ( !config ) {
      this.error("No serverless-package-python-functions configuration detected. Please see documentation")
    }
    this.requirementsFile = config.requirementsFile || 'requirements.txt'
    config.buildDir ? this.buildDir = config.buildDir : this.error("No buildDir configuration specified")
    this.globalRequirements = config.globalRequirements || []
    this.globalIncludes = config.globalIncludes || []
    config.cleanup === undefined ? this.cleanup = true : this.cleanup = config.cleanup
    this.useDocker = config.useDocker || false
    this.dockerImage = config.dockerImage || `lambci/lambda:build-${this.serverless.service.provider.runtime}`
    this.containerName = config.containerName || 'serverless-package-python-functions'
    this.mountSSH = config.mountSSH || false
    this.abortOnPackagingErrors = config.abortOnPackagingErrors || false
    this.dockerServicePath = '/var/task'
  }

  autoconfigArtifacts() {
    _.map(this.serverless.service.functions, (func_config, func_name) => {
      let autoArtifact = `${this.buildDir}/${func_config.name}.zip`
      func_config.package.artifact = func_config.package.artifact || autoArtifact
      this.serverless.service.functions[func_name] = func_config
    })
  }

  clean(){
    if (!this.cleanup) {
      this.log('Cleanup is set to "false". Build directory and Docker container (if used) will be retained')
      return false
    }
    this.log("Cleaning build directory...")
    Fse.removeAsync(this.buildDir)
            .catch( err => { this.log(err) } )

    if (this.useDocker){
      this.log("Removing Docker container...")
      this.runProcess('docker', ['stop',this.containerName,'-t','0'])
    }
    return true
  }

  selectAll() {
    const functions = _.reject(this.serverless.service.functions, (target) => {
      return target.runtime && !(target.runtime + '').match(/python/i);
    });

    const info = _.map(functions, (target) => {
      return {
        name: target.name,
        includes: target.package.include,
        artifact: target.package.artifact
      }
    })
    return info
  }

  installRequirements(buildPath,requirementsPath){

    if ( !Fse.pathExistsSync(requirementsPath) ) {
      return
    }
    const size = Fse.statSync(requirementsPath).size

    if (size === 0){
      this.log(`WARNING: requirements file at ${requirementsPath} is empty. Skiping.`)
      return
    }

    let cmd = 'pip'
    let args = ['install', '--upgrade', '-t', upath.normalize(buildPath), '-r']
    if ( this.useDocker === true ){
      cmd = 'docker'
      args = ['exec', this.containerName, 'pip', ...args]
      requirementsPath = `${this.dockerServicePath}/${requirementsPath}`
    }

    args = [...args, upath.normalize(requirementsPath)]
    return this.runProcess(cmd, args)
  }

  checkDocker(){
    const out = this.runProcess('docker', ['version', '-f', 'Server Version {{.Server.Version}} & Client Version {{.Client.Version}}'])
    this.log(`Using Docker ${out}`)
  }

  runProcess(cmd,args){
    const ret = ChildProcess.spawnSync(cmd,args)
    if (ret.error){
      throw new this.serverless.classes.Error(`[serverless-package-python-functions] ${ret.error.message}`)
    }

    const out = ret.stdout.toString()

    if (ret.stderr.length != 0){
      const errorText = ret.stderr.toString().trim()
      this.log(errorText) // prints stderr

      if (this.abortOnPackagingErrors){
        const countErrorNewLines = errorText.split('\n').length

        
        if(!errorText.includes("ERROR:") && countErrorNewLines < 2 && errorText.toLowerCase().includes('git clone')){
          // Ignore false positive due to pip git clone printing to stderr
        } else if(errorText.toLowerCase().includes('warning') && !errorText.toLowerCase().includes('error')){
          // Ignore warnings
        } else if(errorText.toLowerCase().includes('docker')){
          console.log('stdout:', out)
          this.error("Docker Error Detected")
        } else {
          // Error is not false positive, 
          console.log('___ERROR DETECTED, BEGIN STDOUT____\n', out)
          this.requestUserConfirmation()
        }
      }

    }

    return out
  }

  requestUserConfirmation(prompt="\n\n??? Do you wish to continue deployment with the stated errors? \n",
                          yesText="Continuing Deployment!",
                          noText='ABORTING DEPLOYMENT'
                          ){
    const response = readlineSync.question(prompt);
    if(response.toLowerCase().includes('y')) {
      console.log(yesText);
      return
    } else {
      console.log(noText)
      this.error('Aborting')
      return
    }
  }

  setupContainer(){
    let out = this.runProcess('docker',['ps', '-a', '--filter',`name=${this.containerName}`,'--format','{{.Names}}'])
    out = out.replace(/^\s+|\s+$/g, '')

    if ( out === this.containerName ){
      this.log('Container already exists. Reusing.')
      let out = this.runProcess('docker', ['kill', `${this.containerName}`])
      this.log(out)
    }
    
    let args = ['run', '--rm', '-dt', '-v', `${process.cwd()}:${this.dockerServicePath}`]

    if (this.mountSSH) {
      args = args.concat(['-v', `${process.env.HOME}/.ssh:/root/.ssh`])
    }

    args = args.concat(['--name',this.containerName, this.dockerImage, 'bash'])
    this.runProcess('docker', args)
    this.log('Container created')
  }

  ensureImage(){
    const out = this.runProcess('docker', ['images', '--format','{{.Repository}}:{{.Tag}}','--filter',`reference=${this.dockerImage}`]).replace(/^\s+|\s+$/g, '')
    if ( out != this.dockerImage ){
      this.log(`Docker Image ${this.dockerImage} is not already installed on your system. Downloading. This might take a while. Subsequent deploys will be faster...`)
      this.runProcess('docker', ['pull', this.dockerImage])
    }
  }

  setupDocker(){
    if (!this.useDocker){
      return
    }
    this.log('Packaging using Docker container...')
    this.checkDocker()
    this.ensureImage()
    this.log(`Creating Docker container "${this.containerName}"...`)
    this.setupContainer()
    this.log('Docker setup completed')
  }

  makePackage(target){
    this.log(`Packaging ${target.name}...`)
    const buildPath = Path.join(this.buildDir, target.name)
    const requirementsPath = Path.join(buildPath,this.requirementsFile)
    // Create package directory and package files
    Fse.ensureDirSync(buildPath)
    // Copy includes
    let includes = target.includes || []
    if (this.globalIncludes){
      includes = _.concat(includes, this.globalIncludes)
    }
    _.forEach(includes, (item) => { Fse.copySync(item, buildPath) } )

    // Install requirements
    let requirements = [requirementsPath]
    if (this.globalRequirements){
      requirements = _.concat(requirements, this.globalRequirements)
    }
    _.forEach(requirements, (req) => { this.installRequirements(buildPath,req) })
    zipper.sync.zip(buildPath).compress().save(`${buildPath}.zip`)
  }



  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.log = (msg) => { this.serverless.cli.log(`[serverless-package-python-functions] ${msg}`) }
    this.error = (msg) => { throw new Error(`[serverless-package-python-functions] ${msg}`) }



    this.hooks = {
      'before:package:createDeploymentArtifacts': () => BbPromise.bind(this)
        .then(this.fetchConfig)
        .then(this.autoconfigArtifacts)
        .then( () => { Fse.ensureDirAsync(this.buildDir) })
        .then(this.setupDocker)
        .then(this.selectAll)
        .map(this.makePackage),

      'after:deploy:deploy': () => BbPromise.bind(this)
        .then(this.clean)
    };

  }
}

module.exports = PkgPyFuncs;
