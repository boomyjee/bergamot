const fs = require("fs");
const {basename,dirname,relative,normalize,extname,resolve} = require('path');
 
const is_dir = (path) => fs.existsSync(path) && fs.lstatSync(path).isDirectory()
const teacss = require("./teacss-core.js");

const cwd = process.cwd();
let command = process.argv[2];
let config_keys = process.argv.slice(3);

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
    let configs = {};

    if (fs.existsSync(configPath)) {
        let all_configs = require(configPath);
        if (config_keys.length==0) config_keys = [Object.keys(all_configs)[0]];

        console.log("Reading config file with keys",config_keys);
        config_keys.forEach((config_key) => {
            if (all_configs[config_key]) {
                let config = all_configs[config_key];
                if (!config.bundle_path || !config.entry_point) {
                    return console.log("Please define bundle_path and entry point for config ",config_key);
                }
                configs[config_key] = config;
            } else {
                return console.log("Config key is absent in config",config_key);
            }
        })
    } else {
        return console.log("Can't find config file");
    }

    let cache;
    let config_dir = cwd+"/";
    let config_dir_wo_slash = cwd;

    let import2rel = function(import_uri,import_path) {
        let abs = normalize(dirname(import_path)+"/"+import_uri);
        let ext = extname(abs).substring(1);
        if (is_dir(abs)) abs = resolve(abs,'index'+extname(import_path));
        else if (!ext) abs += extname(import_path);
        let result = relative(config_dir,abs);
        return result;
    };

    let process = function (rel_path,type) {
        if (cache[type][rel_path]!==undefined) return;

        let path = config_dir+rel_path;

        if (!fs.existsSync(path) || is_dir(path)) {
            console.log("Can't include file",path);
            return cache[type][rel_path] = false;
        }

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

        cache[type][rel_path] = text;
        sub_uris.forEach((sub_uri)=>process(sub_uri,path_ext=='tea' ? 'tea' : type));
    };

    let build = (do_minify) => {
        teacss.parsed = {};
        cache = {js:[],tea:[]}

        let already_bundled = {};
        let startTime = new Date().getTime();

        Object.keys(configs).forEach((config_key,config_key_index) => {

            let {root_path,entry_point,bundle_path,js_transform,css_transform} = configs[config_key];
            root_path = root_path ? root_path : cwd;

            config_dir = root_path+"/";
            config_dir_wo_slash = root_path;

            let bundle_dir = root_path+"/"+dirname(bundle_path);

            let entry_type = extname(entry_point).substring(1)=="tea" ? "tea" : "js";
            process(import2rel(basename(entry_point),root_path+"/"+entry_point),entry_type);

            var build_js = "";
            var build_css = "";

            if (config_key_index==0) {
                build_js = "("+loadRequire.toString()+")(window,document.currentScript.src.replace(/\\/[^/]*?$/,'/'))\n";
            }

            function path_string(path) {
                return "'"+path.replace(/\\?("|')/g,'\\$1')+"'";
            }    

            let css_pattern = /url\(['"]?([^'"\)]*)['"]?\)/g;
            let css_text_relative = (text,path) => text.replace(css_pattern,(s,part) => {
                if (/^(data:)/.test(part)) return s;
                var is_abs = part[0]=="/";
                if (!is_abs && !path) return s;
                var part_abs = is_abs ? normalize(part) : dirname(path)+"/"+part;
                var rel = relative(bundle_dir,part_abs);
                return 'url('+rel+')';
            })

            function processTea(abs_url) {
                let old_getFile = teacss.getFile;
                teacss.getFile = function (path,cb) {
                    var rel = relative(config_dir_wo_slash,path);
                    var rel_clean = normalize(rel);
                    var text = deps.js[rel_clean]===undefined ? deps.tea[rel_clean] : deps.js[rel_clean];
                    if (text===undefined) {
                        console.debug("Can't import tea",path,rel); 
                    } else {
                        teacss.files[path] = text;
                    }
                    cb(text);
                };
                try {
                    teacss.process(abs_url,()=>{
                        teacss.getFile = old_getFile;
                        teacss.tea.Style.get(
                            (css) => build_css += css+"\n",
                            css_text_relative
                        );
                        teacss.tea.Script.get((js) => build_js += js+"\n");
                    });
                } catch (e) {
                    console.debug("teacss error\n",e);
                }
            };    

            let deps = cache;
            for (let rel_path in deps.js) {
                let abs_url = config_dir+rel_path;
                let text = deps.js[rel_path];
                if (text===false) continue;
                if (already_bundled[abs_url]) continue;
                already_bundled[abs_url] = true;

                let ext = extname(rel_path).substring(1);
                if (ext=='js') {
                    var js = "(function(){var exports={},module={exports:false};";
                    js += "\n"+text;
                    js += "\n" + "return module.exports || exports;})";
                    if (command=="minify") {
                        build_js += "define("+path_string(rel_path)+","+js+")\n";
                    } else {
                        js += "\n//# sourceURL=bergamot://bundle/"+rel_path;
                        build_js += "define("+path_string(rel_path)+",eval.call(null,"+JSON.stringify(js)+"))\n";
                    }
                }
                if (ext=="css") {
                    build_js += "define("+path_string(rel_path)+",()=>{})\n";
                    build_css += css_text_relative(text,abs_url)+"\n";
                }
                if (ext=="tea") {
                    build_js += "define("+path_string(rel_path)+",()=>{})\n";
                    processTea(abs_url);
                }            
            }    

            let entry_ext = extname(entry_point).substring(1);
            var entry_rel = entry_point;

            if (entry_ext=="js") {
                build_js += "require("+path_string(entry_rel)+")";
            }
            if (entry_ext=="tea") {
                build_js = "";
                processTea(config_dir+entry_rel);
            }

            if (do_minify) {
                build_js = ((js)=>{
                    let Terser = require("terser");
                    var terserResult = Terser.minify(js);
                    if (terserResult.error) {
                        console.debug("Minify error", terserResult.error);
                    } else {
                        js = terserResult.code;
                        if (js_transform) {
                            console.debug('Custom js transform',js_transform);
                            js = js_transform(js);
                        }
                    }
                    return js;
                })(build_js);
                build_css = ((css)=>{
                    require("./clean-css.js");
                    css = CleanCSS.process(css);
                    if (css_transform) {
                        console.debug('Custom css transform',css_transform);
                        css = config.css_transform(css);
                    }
                    return css;
                })(build_css);
            }
            

            console.log("Writing "+bundle_path);
            fs.writeFileSync(root_path + "/" + bundle_path,build_js);
            
            let css_path = dirname(bundle_path)+"/"+basename(bundle_path,extname(bundle_path))+".css";
            let css_path_abs = root_path + "/" + css_path;
            console.log("Writing "+css_path);
            fs.writeFileSync(css_path_abs,build_css);
        })

        let endTime = new Date().getTime();
        console.log("Completed in "+((endTime-startTime)/1000)+"s");
    }

    let watchers = {};
    let rebuildTimeout;
    let watch = () => {
        build();
        let deps = [...Object.keys(cache.js),...Object.keys(cache.tea)];
        let new_watchers = {};
        deps.forEach((dep)=>{
            let path = resolve(config_dir,dep);

            let watcher;
            if (path in watchers) {
                watcher = watchers[path];
                delete watchers[path];
            } else {
                if (!fs.existsSync(path)) return;
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
        console.log("Watching for changes");
    }

    if (command=="build") {
        build();
    }
    if (command=='minify') {
        build(true);
    }
    if (command=='watch') {
        watch();
    }
}

main();

