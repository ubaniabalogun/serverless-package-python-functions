# serverless-package-python-functions

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-package-python-functions.svg)](https://badge.fury.io/js/serverless-package-python-functions)

- [Installation](#install)
- [What's it?](#what)
- [Why do I need it?](#why)
- [How does it work?](#how)

## <a id="install">Installation</a>

```
$ npm install --save serverless-package-python-functions
```

```
# serverless.yml
plugins:
  - serverless-package-python-functions
```

## <a id="what">What is it?</a>
A Serverless Framework plugin for packaging Python Lambda functions with only the dependencies they need.

## <a id="why">Why do I need it?</a>

This plugin makes it easy to manage function-level and service-level dependencies for your awesome Python Serverless project

Let's consider the following project structure

```
your-awesome-project/
├── common_files
│   ├── common1.py
│   └── common2.py
├── function1
│   ├── lambda.py
│   └── requirements.txt # with simplejson library
├── function2
│   ├── lambda.py
│   └── requirements.txt
├── requirements.txt # with requests library
└── serverless.yml
```

This project has:
- two functions, `function1` and `function2`, each with their own `requirements.txt` files. function1's requirements.txt lists the simplejson pip package
- Code common to both `function1` and `function2` in a directory named `common_files`
- A top-level `requirements.txt` file with pip dependencies common to both functions, e.g requests library

This plugin will package your functions into individual zip files that look like:

```
├── lambda.py # function-level code
├── requirements.txt
├── common1.py # service-level code
├── common2.py
├── simplejson # function-level dependencies
├── simplejson-3.10.0.dist-info
├── requests # service-level dependencies
└── requests-2.13.0.dist-info
```

So that the below code
```
import common1, common2, requests, simplejson
```
in function1/lambda.py works like works like a charm!

The plugin also supports packaging your dependencies using a Docker Image that replicates your cloud providers environment, allowing you easily work with platform-dependent libraries like numpy.


## <a id="how">How does it work?</a>
The plugin handles the creation of the [artifact zip files](https://serverless.com/framework/docs/providers/aws/guide/packaging#artifact) for your Serverless functions.

When `serverless deploy` is run, the plugin will:
1. create a build directory for each function
2. copy the appropriate function-level and service-level code you specify into each function's build directory
3. Download the appropriate function-level and service-level pip dependencies into each function's build directory
4. Create zip files of each functions build directory

The Serverless framework will then pickup each zip file and upload it to your provider.

Here's a simple `serverless.yml` configuration for this plugin, assuming the project structure above
one of the functions we add `-${opt:stage}` to the name in order to append the stage to the function name

```
service: your-awesome-project

package:
    individually: true
    
plugins:
  - serverless-package-python-functions

custom:
  pkgPyFuncs: # plugin configuration
    buildDir: _build
    requirementsFile: 'requirements.txt'
    globalRequirements:
      - ./requirements.txt
    globalIncludes:
      - ./common_files
    cleanup: true

functions:
  function1:
    name: function1-${opt:stage}
    handler: lambda.handler
    package:
      include:
        - function1
      artifact: ${self:custom.pkgPyFuncs.buildDir}/function1.zip

  function2:
    name: function2
    handler: lambda.handler
    package:
      include:
        - function2
      artifact: ${self:custom.pkgPyFuncs.buildDir}/function2.zip
```

The plugin configurations are simple:

| Configuration      | Description                                                                                                                                                                                                        | Optional?                                                  |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| buildDir           | Path to a build directory relative to project root, e.g. build                                                                                                                                                     | No                                                         |
| requirementsFile   | The name of the requirements file used for function-level requirements. All function-level requirements files must use the name specified here.                                                                    | Yes. Defaults to `requirements.txt`                        |
| globalRequirements | A list of paths to files containing service-level pip requirements.                                                                                                                                                | Yes                                                        |
| globalIncludes     | A list of paths to folders containing service-level code files (i.e. code common to all functions). Only the folders contents will be packaged, not the folder itself. Paths to files are not currently supported. | Yes                                                        |
| useDocker          | Boolean indicating whether to package pip dependencies using Docker. Set this to true if your project uses platform-specific compiled libraries like numpy. Requires a [Docker installation](https://www.docker.com/get-docker).                        | Yes. Defaults to `false`                                   |
| dockerImage        | The Docker image to use to compile functions if `useDocker` is set to `true`. Must be specified as `repository:tag`. If the image doesn't exist on the system, it will be downloaded. The initial download may take some time.                            | Yes. Defaults to `lambci/lambda:build-${provider.runtime}` |
| containerName      | The desired name for the Docker container.                                                                                                                                                                         | Yes. Defaults to `serverless-package-python-functions`     |
| abortOnPackagingErrors | Boolean indicating whether you want to stop deployment when packaging errors are detected. Examples of scenarios that will cause packaging errors include: `useDocker` is enabled but the Docker service is not running, pip finds dependency mismatches, virtual environment errrors, etc.. When an error is detected, this will prompt via commandline to continue or abort deploy. | Yes. Defaults to `false` |

At the function level, you:
- Specify `name` to give your function a name. The plugin uses the function's name as the name of the zip artifact
- Use `include` to specify what function-level files you want to include in your artifact. Simply specifying the path to the function's folder will include every file in the folder in the function's zip artifact
- Use `artifact` to tell Serverless where to find the zip artifact. The plugin creates the zip artifact for the function at `buildDir`/`name`.zip, so using `${self:custom.pkgPyFuncs.buildDir}/[function-name-here].zip` is advised.

At the package level, you may need to:
- Specify the `individually` parameter as `true` to ensure that zip artifacts are generated properly. You may need this if you are getting file not found errors about your zip artifact.

Now, you may be wondering, doesn't the [Serverless documentation say](https://serverless.com/framework/docs/providers/aws/guide/packaging#artifact):
> Serverless won't zip your service if [artifact] is configured and therefore exclude and include will be ignored. Either you use artifact or include / exclude.

Yes, that is correct and is actually awesome! Since Serverless ignores `include`/`exclude` silently when `artifact` is specified, it allows this plugin take advantage of the `include` property to provide you with a familiar interface for specifying function-level dependencies. So while this plugin uses `include` to determine what goes in your artifact, all Serverless cares about is the artifact that this plugin creates when it executes.

The last thing that your keen eye may have noticed from the example `serverless.yml` above is that `handler` is specified simply as `lambda.handler` not `${self:custom.pkgPyFuncs.buildDir}/function/lambda.hadler` or `function/lambda.handler`. This is because the plugin zips your artifacts such that /path/to/function is the root of the zip file. Combined with the fact that it uses `pip install -t` to download pip dependencies directly to the top level of the zip file, this makes imports significantly simpler for your project.
Furthermore, since `pip install -t` downloads the actual pip package files into a folder, this plugin works without the need for `virtualenv`
