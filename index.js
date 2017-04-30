'use strict';

const BbPromise = require('bluebird');
const _ = require('lodash');
const Fse = require('fs-extra');
const Path = require('path');
const ChildProcess = require('child_process');
const zipdir = require('zip-dir');

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
    config.requirementsFile ? this.requirementsFile = config.requirementsFile  : this.requirementsFile = 'requirements.txt'
    config.buildDir ? this.buildDir = config.buildDir : this.error("No buildDir configuration specified")
    config.globalRequirements ? this.globalRequirements = config.globalRequirements : this.globalRequirements = null
    config.globalIncludes ? this.globalIncludes = config.globalIncludes : this.globalIncludes = null
    config.cleanup === undefined ? this.cleanup = true : this.cleanup = config.cleanup
  }

  clean(){
    if (!this.cleanup) {
      return false
    }
    this.log("Cleaning build directory")
    Fse.removeAsync(this.buildDir)
            .catch( err => { this.log(err) } )
    return true
  }

  selectAll() {
    const functions = this.serverless.service.functions

    const info = _.map(functions, (target) => {
      return {
        name: target.name,
        includes: target.package.include
      }
    })
    return info
  }


  installRequirements(buildPath,requirementsPath){
    return ChildProcess.spawnSync('pip',['install','-t',buildPath,'-r',requirementsPath])
  }

  makePackage(target){
    this.log(`Packaging ${target.name}`)
    const buildPath = Path.join(this.buildDir, target.name)
    const requirementsPath = Path.join(buildPath,this.requirementsFile)
    // Create package directory and package files
    Fse.ensureDirSync(buildPath)
    // Copy includes
    let includes = target.includes
    if (this.globalIncludes){
      includes = _.concat(includes, this.globalIncludes)
    }
    _.forEach(includes, (item) => { Fse.copySync(item, buildPath) } )

    // Install requirements
    let requirements = [requirementsPath]
    if (this.globalRequirements){
      requirements = _.concat(requirements, this.globalRequirements)
    }
    _.forEach(requirements, (req) => { this.installRequirements(buildPath,req)})
    zipdir(buildPath, { saveTo: `${buildPath}.zip`}, (err,buffer) => {} )
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
        .then(this.selectAll)
        .map(this.makePackage),

      'after:deploy:deploy': () => BbPromise.bind(this)
        .then(this.clean)
    };

  }
}

module.exports = PkgPyFuncs;
