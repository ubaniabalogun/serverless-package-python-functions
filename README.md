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


## <a id="how">How does it work?</a>
The plugin handles the creation of the [artifact zip files](https://serverless.com/framework/docs/providers/aws/guide/packaging#artifact) for your Serverless functions.

When `serverless deploy` is run, the plugin will:
1. create a build directory for each function
2. copy the appropriate function-level and service-level code you specify into each function's build directory
3. Download the appropriate function-level and service-level pip dependencies into each function's build directory
4. Create zip files of each functions build directory

The Serverless framework will then pickup each zip file and upload it to your provider.

Here's a simple `serverless.yml` configuration for this plugin, assuming the project structure above

```
service: your-awesome-project

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
    name: function1
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
- `buildDir`: (Required) Path to a build directory the plugin can work in. It is created by the plugin if it doesn't exist.
- `requirementsFile`: (Optional, Defaults to `requirements.txt`) The name of the pip requirements file for each function. All function-level requirements files must use the name specified here
- `globalRequirements`: (Optional) A list of paths to files containing service-level pip requirements
- `globalIncludes`: (Optional) A list of paths to folders containing service-level code files (i.e. code common to all functions)
- `cleanup`: (Optional, Defaults to true) Boolean indicating whether or not to delete the build directory after Serverless is done uploading the artifacts

At the function level, you:
- Specify `name` to give your function a name. The plugin uses the function's name as the name of the zip artifact
- Use `include` to specify what function-level files you want to include in your artifact. Simply specifying the path to the function's folder will include every file in the folder in the function's zip artifact
- Use `artifact` to tell Serverless where to find the zip artifact. The plugin creates the zip artifact for the function at `buildDir`/`name`.zip, so using `${self:custom.pkgPyFuncs.buildDir}/[function-name-here].zip` is advised.

Now, you may be wondering, doesn't the [Serverless documentation say](https://serverless.com/framework/docs/providers/aws/guide/packaging#artifact):
> Serverless won't zip your service if [artifact] is configured and therefore exclude and include will be ignored. Either you use artifact or include / exclude.

Yes, that is correct and is actually awesome! Since Serverless ignores `include`/`exclude` silently when `artifact` is specified, it allows this plugin take advantage of the `include` property to provide you with a familiar interface for specifying function-level dependencies. So while this plugin uses `include` to determine what goes in your artifact, all Serverless cares about is the artifact that this plugin creates when it executes.

The last thing that your keen eye may have noticed from the example `serverless.yml` above is that `handler` is specified simply as `lambda.handler` not `${self:custom.pkgPyFuncs.buildDir}/function/lambda.hadler` or `function/lambda.handler`. This is because the plugin zips your artifacts such that /path/to/function is the root of the zip file. Combined with the fact that it uses `pip install -t` to download pip dependencies directly to the top level of the zip file, this makes imports significantly simpler for your project.
Furthermore, since `pip install -t` downloads the actual pip package files into a folder, this plugin works without the need for `virtualenv`
