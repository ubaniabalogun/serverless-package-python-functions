'use strict';

const BbPromise = require('bluebird');
const _ = require('lodash');
const Fse = require('fs-extra');
const Path = require('path');
const ChildProcess = require('child_process');
const zipper = require('zip-local');
const upath = require('upath');

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
    this.dockerServicePath = '/var/task'
    this.ignorePipVersionCheck = config.ignorePipVersionCheck || false;
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
    const functions = this.serverless.service.functions
    const info = _.map(functions, (target) => {
      return {
        name: target.name,
        requirePackages: target.requirePackages,
        includes: target.package.include,
        excludes: target.package.exclude,
        skip: target.skipPkgPyFuncs
      }
    })
    return info
  }


  installRequirements(buildPath, requirementsPath){

    if ( !Fse.pathExistsSync(requirementsPath) ) {
      return
    }
    const size = Fse.statSync(requirementsPath).size

    if (size === 0){
      this.log(`WARNING: requirements file at ${requirementsPath} is empty. Skiping.`)
      return
    }

    let cmd = 'pip'
    let args = ['install','--upgrade','-t', upath.normalize(buildPath), '-r']
    if ( this.useDocker === true ){
      cmd = 'docker'
      args = ['exec', this.containerName, 'pip', ...args]
      requirementsPath = `${this.dockerServicePath}/${requirementsPath}`
    }

    args = [...args, upath.normalize(requirementsPath)]
    if (this.ignorePipVersionCheck) {
      args.push('--disable-pip-version-check')
    }
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

    if (ret.stderr.length != 0){
      throw new this.serverless.classes.Error(`[serverless-package-python-functions] ${ret.stderr.toString()}`)
    }

    const out = ret.stdout.toString()
    return out
  }

  setupContainer(){
    let out = this.runProcess('docker',['ps', '-a', '--filter',`name=${this.containerName}`,'--format','{{.Names}}'])
    out = out.replace(/^\s+|\s+$/g, '')

    if ( out === this.containerName ){
      this.log('Container already exists. Reusing.')
    } else {
      this.runProcess(
        'docker',
        ['run', '--rm', '-dt', '-v', `${process.cwd()}:${this.dockerServicePath}`,
          '--name',this.containerName, this.dockerImage, 'bash']
        )
      this.log('Container created')
    }
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
    const buildPath = Path.join(this.buildDir, target.name)
    const requirementsPath = Path.join(buildPath, this.requirementsFile)
    const requirePackages = target.requirePackages;
    const excludes = target.excludes || [];
    const skip = target.skip;

    // Create package directory and package files
    Fse.removeSync(buildPath)
    Fse.ensureDirSync(buildPath)

    // Write require package to <function folder>/requirements.txt
    if(!skip && requirePackages && requirePackages.length > 0) {
      Fse.writeFileSync(buildPath + '/requirements.txt', '')
      requirePackages.forEach(x => {
        Fse.appendFileSync(buildPath + '/requirements.txt', x + '\n')
      });
    }

    let logStr = target.requirePackages ? `with packages: ${target.requirePackages}` : ''
    this.log(`Packaging ${target.name}... ${logStr}`)

    // Copy includes
    let includes = target.includes || []

    // Global Includes
    if(this.globalIncludes && this.globalIncludes.length > 0) {
      this.log("Add Global Includes...")
      _.filter(this.globalIncludes, item => {
        if (excludes.includes(item)) {
          this.log(`  Exclude item: ${item}`)
          return false;
        } else {
          return true;
        }
      }).forEach(item => {
        Fse.copySync(item, Path.resolve(buildPath, item))
      })
    }

    // Functions Include
    this.log("Add Functions Includes...")
    _.forEach(includes, (item) => {
      if(Fse.lstatSync(Path.resolve(item)).isDirectory()) {
        Fse.copySync(item, Path.resolve(buildPath))
      } else {
        Fse.copySync(item, Path.resolve(buildPath, item))
      }
    })

    // Install requirements
    if (!skip) {
      let requirements = [requirementsPath]
      if (this.globalRequirements) {
        requirements = _.concat(requirements, this.globalRequirements)
      }
      _.forEach(requirements, (req) => {
        this.installRequirements(buildPath, req)
      })
    }

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
