const fs = require('fs')
const path = require('path')
const util = require('util')
const child_process = require('child_process');
const assert = require('assert').strict; 
const terser = require("terser");

let bergamot = (args) =>  child_process.execSync('node ../bergamot.js ' + args, {cwd:__dirname+"/temp"}).toString();
let bergamotAsync = (args) => child_process.spawn('node', ['../bergamot.js', args], {cwd:__dirname+"/temp"});

async function testEnv(env, callback) {
    try { fs.mkdirSync(__dirname + "/temp");} catch {}

    if (env.config) {
        fs.writeFileSync(__dirname + "/temp/bergamot.config.js", "module.exports = "+ util.inspect(env.config));
    }
    if (env.files) {
        Object.entries(env.files).forEach(([key, value]) => {
            fs.writeFileSync(__dirname + '/temp/' + key, value.join("\n"))
        });
    }
    await callback();
    fs.rmdirSync(__dirname + "/temp", {recursive:true});
}

let envFile = (fileName) => fs.readFileSync(__dirname + '/temp/' + fileName, 'utf8').toString();
let envFileWrite = (fileName,content) => fs.writeFileSync(__dirname + '/temp/' + fileName, content);


let loadRequire = function (w,root) {
    w.require = function (path) {
        var res_path = root+path;
        if (w.require.cache.modules[res_path]) return w.require.cache.modules[res_path];
        if (!w.require.cache.defines[res_path]) {
            console.debug("Can't require on path: ",path,res_path);
            try { throw new Error; } catch(e) { console.log(e.stack); }
            return {};
        }
        return w.require.cache.modules[res_path] = w.require.cache.defines[res_path]();
    }
    w.require.cache = w.require.cache || { modules:{}, defines:{} }
    w.define = w.define || function (path,f) { w.require.cache.defines[root+path] = f };
}
let requireCode = "("+loadRequire.toString()+")(window,document.currentScript.src.replace(/\\/[^/]*?$/,'/'))\n";

describe("Bergamot tests", function() {

    it('Wrong command',() => testEnv({},()=>{
        assert.equal(
            bergamot("uninstall"), 
            "Pls specify valid command: build, watch, minify\n"
        );
    }));
    
    let actualCommands = ['build', 'watch', 'minify']
    actualCommands.forEach(function(command) {
        it('Command ' + command + ' without config file',() => testEnv({},()=>{
            assert.equal(
                bergamot(command), 
                "Can't find config file\n"
            );
        }));
    });
    
    let getCompleteTime = (output) => output.match(/[+-]?([0-9]*[.])?[0-9]+/g).toString()

    it('No project keys on config file.',() => testEnv({
        config: {
            project : {}
        },
    },
    () => {
        let output = bergamot("build");
        assert.equal(
            output, 
              "Reading config file with keys [ 'project' ]\n"
            + "Please define bundle_path and entry point for config  project\n"
            + "Completed in " + getCompleteTime(output) + "s\n"
        );
    }));

    it('Missing entry_point file',() => testEnv({
        config: {
            project : {
                bundle_path : "bundle.min.js",
                entry_point : "index.js",
            }
        },
    },
    () => {
        let output = bergamot("build");
        assert.equal(
            output,
              "Reading config file with keys [ 'project' ]\n"
            + "Can't include file " + path.join(__dirname, "temp") + "/index.js\n"
            + "Writing bundle.min.js\n"
            + "Writing ./bundle.min.css\n"
            + "Completed in " + getCompleteTime(output) +"s\n"
        );
    }));
    

    let sourceUrlHint = (fileName) => "\n//# sourceURL=bergamot://bundle/" + fileName
    let moduleExport = "(function(){var exports={},module={exports:false};\n"
    let moduleReturn = "\nreturn module.exports || exports;})"

    let envJS = {
        config: {
            project : {
                bundle_path : "bundle.min.js",
                entry_point : "index.js",
            }
        },
        files: {
            "index.js": ["let p = require('./home/../plugin.js'); let main = function() {plugin.v()}; main()"],
            "plugin.js" : ["let v = () => {console.log('0.1')}; exports.v = v"],
        }
    }

    it('Build js',() => testEnv(envJS,()=>{
        bergamot("build");
        assert.equal(
            envFile('bundle.min.js'),
            requireCode 
            + "define('index.js',eval.call(null,"
                    + JSON.stringify(
                        moduleExport
                        + "let p = require('plugin.js'); let main = function() {plugin.v()}; main()" 
                        + moduleReturn 
                        + sourceUrlHint('index.js')
                    )
                + ')'
            + ')\n'
            + "define('plugin.js',eval.call(null,"
                    +JSON.stringify(
                        moduleExport
                        + "let v = () => {console.log('0.1')}; exports.v = v" 
                        + moduleReturn 
                        + sourceUrlHint('plugin.js')
                    )
                + ')'
            + ')\n'
            + "require('index.js')"
        );        
    }));

    it('Minify js', () => testEnv(envJS,()=>{
        bergamot("minify");
        assert.equal(
            envFile('bundle.min.js'),
            terser.minify(requireCode
                + "define('index.js',"
                    + moduleExport
                    + "let p = require('plugin.js'); let main = function() {plugin.v()}; main()"
                    + moduleReturn
                +")\n"
                + "define('plugin.js',"
                    + moduleExport
                    + "let v = () => {console.log('0.1')}; exports.v = v" 
                    + moduleReturn
                +")\n"
                + "require('index.js')"
            ).code
        );
    }));

    let envCSS = {
        config: {
            project : {
                bundle_path : "bundle.min.js",
                entry_point : "index.js",
            }
        },
        files: {
            "index.js": ["require('./main.css'); require('./style.css'); let main = function() {console.log('123')}; main()"],
            "main.css": [".wrapper {display: grid;grid-gap: 10px;grid-template-columns: 100px 100px 100px;}"],
            "style.css": ["body { color: red; }"],
        }
    }

    it('Build css', () => testEnv(envCSS,() => {
        bergamot("build");
        assert.equal(
            envFile('bundle.min.js'),
            requireCode 
            + "define('index.js',eval.call(null,"
                    +JSON.stringify(
                        moduleExport
                        + "require('main.css'); require('style.css'); let main = function() {console.log('123')}; main()" 
                        + moduleReturn 
                        + sourceUrlHint('index.js')
                    )
                + ')'
            + ')\n'
            + "define('main.css',()=>{})\n"
            + "define('style.css',()=>{})\n"
            + "require('index.js')"
            );

        assert.equal(
            envFile('bundle.min.css'),
            ".wrapper {display: grid;grid-gap: 10px;grid-template-columns: 100px 100px 100px;}\n"
            + "body { color: red; }\n"
        );
    }));

    it('Minify css.', () => testEnv(envCSS,() =>{
        bergamot("minify");
        assert.equal(
            envFile('bundle.min.css'),
            ".wrapper{display:grid;grid-gap:10px;grid-template-columns:100px 100px 100px}body{color:red}"
        );
    }));

    let envTea = {
        config: {
            project : {
                bundle_path : "bundle.min.js",
                entry_point : "index.js",
            }
        },
        files: {
            "index.js": ["require('./style.tea'); let main = function() {console.log('123')}; main()"],
            "style.tea" : ["p { font-size: 12px; a { text-decoration: none; &:hover { border-width: 1px }}}}",],
        }
    }

    it('Build tea', () => testEnv(envTea,() => {            
        bergamot("build")
        assert.equal(
            envFile('bundle.min.js'),
            requireCode 
            + "define('index.js',eval.call(null,"
                    +JSON.stringify(
                        moduleExport
                        + "require('style.tea'); let main = function() {console.log('123')}; main()" 
                        + moduleReturn 
                        + sourceUrlHint('index.js')
                    )
                + ')'
            + ')\n'
            + "define('style.tea',()=>{})\n\n"
            + "require('index.js')"
        );
    }));

    it('Minify tea', () => testEnv(envTea,() => {            
        bergamot("minify")
        assert.equal(
            envFile('bundle.min.css'),
            "p{font-size:12px}p a{text-decoration:none}p a:hover{border-width:1px}"
        );
    }));

   it('Build project as plugin', () => testEnv({
        config: {
            project : {
                bundle_path : "bundle.min.js",
                entry_point : "index.js",
            },
            funcProject : {
                bundle_path : "bundleFunc.min.js",
                entry_point : "func.js",
            }
        },
        files: {
            "index.js": ["let p = require('./home/../plugin.js'); let main = function() {plugin.v()}; main()"],
            "plugin.js" : ["let v = () => {console.log('0.1')}; exports.v = v"],
            "func.js" : ["const plugin = require('./plugin.js'); plugin.v(); let foo = () => {console.log('Bar')}; foo()"],
        }
    },
    () => { 
        bergamot("build project funcProject")
        assert.equal(
            envFile('bundle.min.js'),
            requireCode
            + "define('index.js',eval.call(null,"
                    +JSON.stringify(moduleExport
                        + "let p = require('plugin.js'); let main = function() {plugin.v()}; main()" 
                        + moduleReturn 
                        + sourceUrlHint('index.js'))
                + ')'
            + ')\n'
            + "define('plugin.js',eval.call(null,"
                    +JSON.stringify(
                        moduleExport
                        + "let v = () => {console.log('0.1')}; exports.v = v" 
                        + moduleReturn 
                        + sourceUrlHint('plugin.js')
                        )
                + ')'
            + ')\n'
            + "require('index.js')"
        );

        assert.equal(
            envFile('bundleFunc.min.js'),
            "define('func.js',eval.call(null,"
                    +JSON.stringify(
                        moduleExport
                        + "const plugin = require('plugin.js'); plugin.v(); let foo = () => {console.log('Bar')}; foo()"
                        + moduleReturn 
                        + sourceUrlHint('func.js')
                    )
                + ')'
            + ')\n'
            + "require('func.js')"
        );
    }));

    it('Watch', () => testEnv({
        config: {
            project : {
                bundle_path : "bundle.min.js",
                entry_point : "index.js",
            },
        },
        files: {
            "index.js": ["let main = function() {console.log()}; main()"],
        }
    }, 
    async () => {
        let process = bergamotAsync('watch');
        after(() => process.kill());

        let firstWatch = true;
        for await (let data of process.stdout) {
            if (!data.toString().includes("Watching for changes")) continue;
            if (firstWatch) {
                firstWatch = false;
                assert.equal(
                    envFile('bundle.min.js'),
                    requireCode 
                    + "define('index.js',eval.call(null,"
                            +JSON.stringify(
                                moduleExport
                                + "let main = function() {console.log()}; main()" 
                                + moduleReturn 
                                + sourceUrlHint('index.js')
                            )
                        + ')'
                    + ')\n'
                    + "require('index.js')"
                );                    
                envFileWrite('index.js', "let main = function() {console.log('123')}; main()")
            } 
            else {
                assert.equal(
                    envFile('bundle.min.js'),
                    requireCode 
                    + "define('index.js',eval.call(null,"
                            +JSON.stringify(
                                moduleExport
                                + "let main = function() {console.log('123')}; main()" 
                                + moduleReturn 
                                + sourceUrlHint('index.js')
                            )
                        + ')'
                    + ')\n'
                    + "require('index.js')"
                );  
                process.kill();                  
                return;
            }
        }
    }));
});