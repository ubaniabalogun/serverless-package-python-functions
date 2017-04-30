# serverless-package-python-functions

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

- [What's it?](#what)
- [Why do I need it?](#why)
- [How does it work?](#how)
- [Configuration](#config)
- [Demo](#demo)
- [Credit](#credit)

## <a id="what">What is it?</a>
A Serverless Framework plugin for packaging Python Lambda functions with only the dependencies they need.

## <a id="why">Why do I need it?</a>
Let's say you have multiple Python lambda functions with some common dependencies and some dependencies that are unique to each function.
Let's say you also plan on using `requirements.txt` files to manage `pip` dependencies.

Your project structure may look something like this:

```
project
├── common_files
│   ├── common1.py
│   └── common2.py
├── function1
│   ├── handler.py
│   └── requirements.txt
├── function2
│   ├── handler.py
│   └── requirements.txt
└── serverless.yml
```

This plugin takes care of downloading the unique requirements for each function and packaging it with any common files needed.
