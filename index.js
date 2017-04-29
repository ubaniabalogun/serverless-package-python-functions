'use strict';

const BbPromise = require('bluebird');
const _ = require('lodash');
const Fse = require('fs-extra');
const Path = require('path');
const ChildProcess = require('child_process');
const zipdir = require('zip-dir');

BbPromise.promisifyAll(Fse);


class PyPkgNeatly {

  fetchConfig(){
    const config = this.serverless.service.custom.pyPkgNeatly

    if (!config) {
      throw new Error("No configuration detected")
    }

    config.requirementsFile ? this.requirementsFile = config.requirementsFile  : this.requirementsFile = 'requirements.txt'
    config.buildDir ? this.buildDir = config.buildDir : (() => { throw new Error("No buildDir config specified") })()
    config.globalRequirements ? this.globalRequirements = config.globalRequirements : this.globalRequirements = null
    config.globalIncludes ? this.globalIncludes = config.globalIncludes : this.globalIncludes = null

  }

  selectAll() {
    const functions = this.serverless.service.functions

    const info = _.map(functions, (target) => {
      return {
        name: target.name,
        includes: target.package.include
      }
    })
    this.log(JSON.stringify(info))
    return info
  }


  installRequirements(buildPath,requirementsPath){
    return ChildProcess.spawnSync('pip',['install','-t',buildPath,'-r',requirementsPath])
  }

  makePackage(target){
    const buildPath = Path.join(this.buildDir, target.name)
    const requirementsPath = Path.join(buildPath,this.requirementsFile)
    this.log(`RequirementsPath is ${requirementsPath}`)
    // Create package directory and package files
    Fse.ensureDirSync(buildPath)
    // Copy includes
    let includes = target.includes
    if (this.globalIncludes){
      includes = _.concat(includes, this.globalIncludes)
    }
    _.forEach(includes, (item) => { Fse.copySync(item, buildPath) } )

    // Install requirements
    this.log(`Installing requirements for ${target.name}`)
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
    this.log = (msg) => { this.serverless.cli.log('[py-pkg-neatly] ' + msg) }




    this.hooks = {
      'before:package:createDeploymentArtifacts': () => BbPromise.bind(this)
        .then(this.fetchConfig)
        .then( () => { Fse.ensureDirAsync(this.buildDir) })
        .then(this.selectAll)
        .map(this.makePackage),

      'after:package:createDeploymentArtifacts': this.welcomeUser.bind(this),
      'after:package:finalize': () => {this.log('after:package:finalize')},
      'before:deploy:deploy': () => {this.log('before:deploy:deploy')}
    };

  }

  welcomeUser() {
    this.log('[py-pkg-neatly] after:package:createDeploymentArtifacts');
  }
}

module.exports = PyPkgNeatly;
