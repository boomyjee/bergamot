#! /usr/bin/env node

const fs = require("fs");
const {basename,dirname,relative,normalize,extname,resolve} = require('path');
 
const is_dir = (path) => fs.existsSync(path) && fs.lstatSync(path).isDirectory()
const teacss = require("./teacss-core.js");

const cwd = process.cwd();
let [command,entry_point,bundle_path] = process.argv.slice(2);

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

function main() {
    if (command!='watch' && command!='build' && command!='minify') 
        return console.log("Pls specify valid command: build, watch, minify");

    let configPath = cwd+"/bergamot.config.js";
    let config = {};

    if (fs.existsSync(configPath)) {
        let configs = require(configPath);
        let config_key = entry_point || Object.keys(configs)[0];
        console.log("Reading config file with key",config_key);
        config = configs[config_key];
        entry_point = config.entry_point;
        bundle_path = config.bundle_path;
    }
    if (!entry_point || !bundle_path) return console.log("Pls specify input and output files");

    let cache;
    let bundle_abs = cwd+"/"+bundle_path;
    let bundle_dir = dirname(bundle_abs)+"/";
    let bundle_dir_wo_slash = dirname(bundle_abs);
    
    let import2rel = function(import_uri,import_path) {
        let abs = normalize(dirname(import_path)+"/"+import_uri);
        let ext = extname(abs).substring(1);
        if (is_dir(abs)) abs = resolve(abs,'index'+extname(import_path));
        else if (!ext) abs += extname(import_path);
        let result = relative(bundle_dir,abs);
        return result;
    };

    let process = function (rel_path,type) {
        if (cache[type][rel_path]!==undefined) return;

        let path = bundle_dir+rel_path;

        if (!fs.existsSync(path) || is_dir(path)) return cache[type][rel_path] = false;

        let path_ext = extname(rel_path).substring(1);
        let text = fs.readFileSync(path,'utf8');

        let sub_uris = [];
        if (path_ext=="tea") {
            let pattern = /@import\s*(\'|")(.*?)(\'|")/g;
            while (match = pattern.exec(text)){
                sub_uris.push(import2rel(match[2],path));
            }
        }
        if (path_ext=="js") {
            let pattern = /require\(\s*('|")(.*?)('|")\s*\)/g;
            text = text.replace(pattern,(m,p1,p2,p3)=>{
                let sub_uri = import2rel(p2,path);
                sub_uris.push(sub_uri);
                return 'require('+p1+sub_uri+p3+')';
            });
        }
        if (path_ext=="css") {
            pattern = /url\(['"]?([^'"\)]*)['"]?\)/gi;
            text = text.replace(pattern,(m,p1) => {
                if (/^(.:\/|data:|http:\/\/|https:\/\/|\/)/.test(p1)) return m;
                return 'url('+import2rel(p1,path)+')';
            });
        }

        cache[type][rel_path] = text;
        sub_uris.forEach((sub_uri)=>process(sub_uri,path_ext=='tea' ? 'tea' : type));
    };

    let build = (js_transform,css_transform) => {
        cache = {js:[],tea:[]}
        let startTime = new Date().getTime();
        let entry_type = extname(entry_point).substring(1)=="tea" ? "tea" : "js";
        process(import2rel(basename(entry_point),cwd+"/"+entry_point),entry_type);

        var build_js = "("+loadRequire.toString()+")(window,document.currentScript.src.replace(/\\/[^/]*?$/,'/'))\n";
        var build_css = "";

        function path_string(path) {
            return "'"+path.replace(/\\?("|')/g,'\\$1')+"'";
        }    

        let css_pattern = /url\(['"]?([^'"\)]*)['"]?\)/g;

        function processTea(abs_url) {
            let old_getFile = teacss.getFile;
            teacss.getFile = function (path,cb) {
                var rel = relative(bundle_dir_wo_slash,path);
                var rel_clean = normalize(rel);
                var text = deps.js[rel_clean]===undefined ? deps.tea[rel_clean] : deps.js[rel_clean];
                if (text===undefined) {
                    console.debug("Can't import tea",path,rel); 
                } else {
                    teacss.files[path] = text;
                }
                cb(text);
            };
            teacss.process(abs_url,()=>{
                teacss.getFile = old_getFile;
                teacss.tea.Style.get(
                    (css) => build_css += css+"\n",
                    (text,path) => text.replace(css_pattern,(s,part) => {
                        if (/^(data:)/.test(part)) return s;
                        var is_abs = part[0]=="/";
                        if (!is_abs && !path) return s;
                        var part_abs = is_abs ? normalize(part) : dirname(path)+"/"+part;
                        var rel = relative(bundle_dir_wo_slash,part_abs);
                        return 'url('+rel+')';
                    })
                );
                teacss.tea.Script.get((js) => build_js += js+"\n");
            });
        };    

        let deps = cache;
        for (let rel_path in deps.js) {
            let abs_url = bundle_dir+rel_path;
            let text = deps.js[rel_path];
            if (text===false) continue;

            let ext = extname(rel_path).substring(1);
            if (ext=='js') {
                var js = "(function(){var exports={},module={exports:false};";
                js += "\n"+text;
                js += "\n" + "return module.exports || exports;})";
                if (command=="build") {
                    build_js += "define("+path_string(rel_path)+","+js+")\n";
                } else {
                    js += "\n//# sourceURL=bergamot://bundle/"+rel_path;
                    build_js += "define("+path_string(rel_path)+",eval.call(null,"+JSON.stringify(js)+"))\n";
                }
            }
            if (ext=="css") {
                build_js += "define("+path_string(rel_path)+",()=>{})\n";
                build_css += text+"\n";
            }
            if (ext=="tea") {
                build_js += "define("+path_string(rel_path)+",()=>true)\n";
                processTea(abs_url);
            }            
        }    

        let entry_ext = extname(entry_point).substring(1);
        var entry_rel = Object.keys(deps[entry_ext])[0];

        if (entry_ext=="js") {
            build_js += "require("+path_string(entry_rel)+")";
        }
        if (entry_ext=="tea") {
            build_js = "";
            processTea(bundle_dir+entry_rel);
        }

        if (js_transform) build_js = js_transform(build_js);
        if (css_transform) build_css = css_transform(build_css);

        console.log("Writing "+bundle_path);
        fs.writeFileSync(bundle_abs,build_js);
        
        let css_path = dirname(bundle_path)+"/"+basename(bundle_path,extname(bundle_path))+".css";
        let css_path_abs = cwd + "/" + css_path;
        console.log("Writing "+css_path);
        fs.writeFileSync(css_path_abs,build_css);

        let endTime = new Date().getTime();
        console.log("Completed in "+((endTime-startTime)/1000)+"s");
    }

    let watchers = {};
    let rebuildTimeout;
    let watch = () => {
        build();
        console.log("Watching for changes");
        let deps = [...Object.keys(cache.js),...Object.keys(cache.tea)];
        let new_watchers = {};
        deps.forEach((dep)=>{
            let path = resolve(bundle_dir,dep);

            let watcher;
            if (path in watchers) {
                watcher = watchers[path];
                delete watchers[path];
            } else {
                watcher = fs.watch(path,{persistent:true},(e)=>{
                    var rebuild = false;
                    if (e === 'rename' || e === 'unlink') {
                        rebuild = true;
                    }
                    else {
                        const text = fs.readFileSync(path,'utf-8');
                        if (text!=cache.js[dep] && text!=cache.tea[dep]) rebuild = true;
                    }
                    if (rebuild) {
                        clearTimeout(rebuildTimeout);
                        rebuildTimeout = setTimeout(watch,50);
                    }
                });
            }
            new_watchers[path] = watcher;
        });
        for (var path in watchers) watchers[path].close();
        watchers = new_watchers;
    }

    if (command=="build") {
        build();
    }
    if (command=='minify') {
        build((js)=>{
            let Terser = require("terser");
            var terserResult = Terser.minify(js);
            if (terserResult.error) {
                console.debug("Minify error", terserResult.error);
            } else {
                js = terserResult.code;
                if (config.js_transform) {
                    console.debug('Custom js transform',config.js_transform);
                    js = config.js_transform(js);
                }
            }
            return js;
        },(css)=>{
            require("./clean-css.js");
            css = CleanCSS.process(css);
            if (config.css_transform) {
                console.debug('Custom css transform',config.css_transform);
                css = config.css_transform(css);
            }
            return css;
        });
    }
    if (command=='watch') {
        watch();
    }
}

main();

