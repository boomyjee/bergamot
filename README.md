<p align="center">
    <img alt="Bergamot" title="Bergamot" src="/images/bergamot.jpg">
</p>

<p align="center">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg">
    <img alt="awesome" src="https://camo.githubusercontent.com/fef0a78bf2b1b477ba227914e3eff273d9b9713d/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f617765736f6d652533462d796573212d627269676874677265656e2e737667">
    <img alt="state" src="https://img.shields.io/badge/state-success-lightgrey">
    <img alt="javascript" src="https://img.shields.io/badge/javascript-+-green">
</p>

<p align="center">
    TeaCSS/CommonJS capable simple and blazing fast ES6-only bundler without AST transforms.
</p>


## Description
Bundle css & js into single file
Can also process `.tea` files (see teacss.org)

## Install
```
npm install --global bergamot 

// or run without install
npx bergamot watch
```

## Use
create "bergamot.config.js"
```javascript
module.exports = {
    project: {
        entry_point: "<path_to_folder>/index.js",
        bundle_path: "<path_to_bundle>/bundle.min.js",
        js_transform: (js) => require("@babel/core").transform(js, {
            plugins: ["@babel/plugin-transform-arrow-functions"]
        }); // custom js transformation (can be used with babel) 
    }
}
```

Then in console:
```
bergamot <command> <config-key>
```

### Commands
- "build"  - build project files (dev build)
- "watch"  - build and watch for changes
- "minify" - build and minify (for production)

You can have multiple bundles in one config file:
```javascript
module.exports = {
    config_key: {
        entry_point: "<path_to_folder>/index.js",
        bundle_path: "<path_to_bundle>/bundle.min.js", //file name can be changed
        js_transform: (js) => ''// custom js transformation 
    },
    other_config_key: {
        entry_point: "<path_to_folder>/index.js",
        bundle_path: "<path_to_bundle>/bundle.min.js", //file name can be changed
    }
}
```
then call
```
bergamot watch other_config_key
```

### License

Application is [MIT licensed](./LICENSE).