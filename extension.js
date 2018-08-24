// jshint esversion: 6

/**
 * @remarks
 * 
 */

const vscode = require('vscode');
const path = require('path');
const util = require('util');
const cp = require("child_process");
const fs = require('fs');

function activate(context) {
    let jsdocViewState = {};
    jsdocViewState.extensionPath = context.extensionPath;
    jsdocViewState.panel = undefined;
    jsdocViewState.panelReady = false;
    jsdocViewState.messages = [];

    context.subscriptions.push(vscode.commands.registerTextEditorCommand('editor.jsdocView', editor => {
        const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if(jsdocViewState.panel === undefined) {
            createJsDocView(jsdocViewState, context, editor);
        } else {                        
            let uri = editor.document.uri;
            let sel = editor.selection.active;
            let rng = editor.document.getWordRangeAtPosition(new vscode.Position(sel.line, sel.character));
            let word = editor.document.getText(rng);
            
            vscode.window.showInformationMessage(util.format("On Word `%s`; Uri: %s ; Sel: %s", word, uri, sel));

            postMessage({ search: word }, jsdocViewState);    
            if(jsdocViewState.panel.visible === false) {
                jsdocViewState.panel.reveal(columnToShowIn);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("jsdocView.start", () => {
        if(jsdocViewState.panel === undefined) {
            createJsDocView(jsdocViewState, context);
        } else {
            const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
            jsdocViewState.panel.reveal(columnToShowIn);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("jsdocView.generate", () => {
        generateJSDocs(jsdocViewState);
    }));
}
exports.activate = activate;

function deactivate() {
}
exports.deactivate = deactivate;

function createJsDocView(_jsdocViewState, _context, _editor) {
    const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    let workspacePath = vscode.Uri.file(vscode.workspace.rootPath);
    let extentionPath = vscode.Uri.file(_jsdocViewState.extensionPath);
    _jsdocViewState.panel = vscode.window.createWebviewPanel(
        'jsdocView',
        "JSDoc View",
        columnToShowIn,
        { enableScripts: true, localResourceRoots: [
            workspacePath,
            extentionPath
        ] }
    );
    
    if(_editor) {
        let uri = _editor.document.uri;
        let sel = _editor.selection.active;
        
        vscode.window.showInformationMessage(util.format("Uri: %s ; Sel: %s", uri, sel));
    }

    getJSDocContent(_jsdocViewState.panel, _jsdocViewState.extensionPath);
    
    _jsdocViewState.panel.onDidChangeViewState((_event) => {
        if(_event.webviewPanel.visible === false) {
            _jsdocViewState.panelReady = false;
        }
    });
    _jsdocViewState.panel.onDidDispose(() => {
        _jsdocViewState.panel = undefined;
        _jsdocViewState.panelReady = false;
    }); //, undefined, _context.subscriptions);

    //-------------------------------------------------------------------------------------
    // This is where we process messages we receive from the render thread (the jsdocView).
    //-------
    _jsdocViewState.panel.webview.onDidReceiveMessage(message => {
        switch (message.command) {
            case 'navigate':
                let urlStub = message.text; // this was arbitrary;
                // Ok, so for docstrap, it generates source code lines with an oddly encoded line number, the exact definition of which
                // I should look up.
                // e.g. lib_index.js.html#sunlight-1-line-54
                urlStub = urlStub.split("#");
                let fName = urlStub[0];
                let anchor = urlStub[1];

                loadJSDoc(_jsdocViewState.panel, fName, _jsdocViewState.extensionPath, anchor);
                return;
            case 'loadUrl':
                let url = message.text;
                getShimmedContent(url, function(_data) {
                    // we need to encode it...
                    let d = util.format("data:text/html;base64,%s", Buffer.from(_data).toString('base64'));
                    postMessage({ iframeSrc: url, load: d }, _jsdocViewState);    
                }, _jsdocViewState.extensionPath);
                return;
            case 'viewReady':
                _jsdocViewState.panelReady = true;
                _jsdocViewState.messages.forEach((msg) => {
                    postMessage(msg, _jsdocViewState);
                });
                _jsdocViewState.messages = [];
                return;
        }
    }, undefined, _context.subscriptions);
    //-------------------------------------------------------------------------------------
}

function postMessage(_message, _jsdocViewState) {
    // So it doesn't dispose of the panel when it goes out of view.
    if(_jsdocViewState.panelReady) {
        _jsdocViewState.panel.postMessage(_message);
    } else {
        _jsdocViewState.messages.push(_message);
    }
}

function generateJSDocs(_state) {
    // basic debounce
    if(_state.childProcess === undefined) {
        let config = vscode.workspace.getConfiguration('jsdocView');
        let cmd = util.format("npm run-script %s", config.get("buildScript"));

        if(!_state._statusBarItem) {
	        _state._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
	    }
	    _state._statusBarItem.text = "jsdoc generation in progress";
        _state._statusBarItem.show();
        
        _state.childProcess = cp.exec(cmd, { cwd: vscode.workspace.rootPath }, (_err, _stdout, _stderr) => {
            _state.childProcess = undefined;
            _state._statusBarItem.hide();
            _state._statusBarItem = undefined;
            if(_err === undefined || _err === null) {
                vscode.window.showInformationMessage('jsdocs generated successfully.');
            } else {
                vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", _err.message));
            }
        });
    } else {
        vscode.window.showInformationMessage('jsdocs are being generated.');
    }
}

function getJSDocContent(_panel, _extPath) {
    const vscode = require('vscode');

    const fileUri = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : undefined;
    const sel = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active : undefined;
    vscode.window.showInformationMessage(util.format('jsdocView launched from %s:%s', fileUri, sel));
    // const uri = encodeLocation(vscode.editor.document.uri, vscode.editor.selection.active);

    try {
        let config = vscode.workspace.getConfiguration('jsdocView');

        // first, verify it has been generated
        let docDir = config.get("docDir");
        let index = path.join(vscode.workspace.rootPath, docDir, "index.html");

        // Generate docs if they do not already exist...
        //! This is a fragile test
        if(!fs.existsSync(index)) {
            // cache?
            let cmd = util.format("npm run-script %s", config.get("buildScript"));

            cp.execSync(cmd, { cwd: vscode.workspace.rootPath });
            // cp.execSync("dir", { stdio: "inherit" });
        } 

        // Load index...
        //! But really I should try to load the appropriate file for the active editor...
        fs.readFile(index, (err, data) => {
            if(err) {            
                vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", err.message));
            }
            _panel.webview.html = shimHtml(data.toString(), _extPath);
        });

        //! Below are the examples for approved vscode method of getting resources from disk.
        // Get path to resource on disk
        // const onDiskPath = vscode.Uri.file(path.join(extensionPath, 'media', 'cat.gif'));

        // And get the special URI to use with the webview
        // const catGifSrc = onDiskPath.with({ scheme: 'vscode-resource' });
    } catch (e) {
        // This usually is generated by security issues.
        console.log(e);
    }
}

function getShimmedContent(_urlRelPath, _cbFn, _extPath) {
    const vscode = require('vscode');
    try {
        let config = vscode.workspace.getConfiguration('jsdocView');
        let docDir = config.get("docDir");
        let resolved = path.join(vscode.workspace.rootPath, docDir, _urlRelPath);

        // Load html page
        fs.readFile(resolved, (err, data) => {
            if(err) {            
                vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", err.message));
            }
            _cbFn(shimHtml(data.toString(), _extPath));
        });
    } catch (e) {
        vscode.window.showErrorMessage(util.format("jsdocView encountered an error shimming %s : `%s`", _urlRelPath, e.message));
    }
}

function loadJSDoc(_panel, _fileName, _extPath, _scrollToPoint) {
    const config = vscode.workspace.getConfiguration('jsdocView');
    const docDir = config.get("docDir");
    let p = path.join(vscode.workspace.rootPath, docDir, _fileName);
    fs.readFile(p, (err, data) => {
        if(err) {            
            vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", err.message));
        }
        _panel.webview.html = shimHtml(data.toString(), _extPath);
        if(_scrollToPoint !== undefined) {
            _panel.webview.postMessage({ scrollTo: _scrollToPoint });
        }
    });
}


/**
 * @desc
 * Process the html provided to make it functional within the gimped environment of a vscode webview.
 * @algorithm
 * This function takes its direction from the configuration settings in `jsdocView.preprocessOptions.*`.
 * - Replace CSP
 * - Replace src attributes on `<script>` and `<a>` tags
 * - shim `<a>` tags
 * @remarks
 * Passing `_sHtml` on the stack is probably unwise for large files.  I deliberate how else I might want to deal.
 * I could use a global, with the potentialy messes that introduces to avoid copying on the stack.  I could roll 
 * reading of the file into this function.  I could box the string buffer and pass it that way, which is probably
 * what I should do.
 * @param {string} _sHtml The string "buffer" containing the html to process.  See remarks.
 * @param {*} _extPath 
 */
function shimHtml(_sHtml, _extPath) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(_sHtml);
    const { URL } = require('url');

    // Now doing this twice...
    const config = vscode.workspace.getConfiguration('jsdocView');
    let docDir = config.get("docDir");
    let projectRootPath = vscode.workspace.rootPath.replace(/\\/g, "/");
    // win32 patch
    let drive = projectRootPath.substring(0, projectRootPath.lastIndexOf(":")+1);
    projectRootPath = projectRootPath.substring(projectRootPath.lastIndexOf(":")+1);
    let docPath = path.posix.join(projectRootPath, docDir);

    //#region Helper functions
    function hasNoProtocol(_url) {
        // So I knew it would be wasteful, but it turns out its requirements cause it to be fail prima facia.
        // let url = new URL(_url, docDir);

        // So I should look up the RFC for protocol specification.  This seems fragile.
        if(/^[\w-_]+:/.test(_url)) {
            return false;
        }
        return true;
    }

    function normalizePath(_el, _sAttr) {
        let el = $(_el);
        let url = el.attr(_sAttr);

        // The trouble here is, relative to what, potentially.
        let p = path.posix.join(docPath, url);
        p = util.format("vscode-resource:/%s%s", drive, p);
        el.attr(_sAttr, p);
    }

    /**
     * @remarks
     * At the moment, all shims are doc dir relative (and treated that way by the shim as well).
     * @param {object} _el 
     */
    function insertShim(_el) {
        let el = $(_el);
        // super fragile
        let ap = el.attr('href');
        // ap = path.posix.join(docDir, ap);
        // ap = ap.replace(/\\/g, "/");
        // let p = path.posix.relative(projectRootPath, ap);
        el.attr('href', null);
        el.attr("onclick", util.format("ss_shim_nav('%s')", ap));
    }

    //#endregion

    try {
        // add/replace content-src policy
        if(config.get("preprocessOptions.replaceCSP")) {
            //<meta http-equiv="Content-Security-Policy"
            let csp = $('meta[http-equiv=Content-Security-Policy]');
            if(csp.length >0) {
                csp.attr('content', "default-src vscode-resource: https: http: data:; img-src vscode-resource: https: data: http:; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource: http:; style-src 'unsafe-inline' vscode-resource: https: http:;");
            } else {
                $('head').prepend('<meta http-equiv="Content-Security-Policy" content="default-src vscode-resource: https: http: data:; img-src vscode-resource: https: http: data:; script-src \'unsafe-inline\' \'unsafe-eval\' vscode-resource: http:; style-src \'unsafe-inline\' vscode-resource: https: http:;">');
            }
        }

        // $('body').append('<script>$(document).ready(function() { console.log("`window` === `window.top`", window === window.top); \
        //  console.log("`window.parent` === `window.top`", window.parent === window.top); \
        //     if(window.parent.postMessage) {  \
        //     	console.log("I have a parent");  \
        //     } \
        //     window.weakid = Math.random() * 20000; \
        //     console.log(window.weakid); \
        //     console.log(window); });</script>');

        // fix link and script tags
        if(config.get("preprocessOptions.fixAttributePaths")) {
            $('[href]').each((idx, el) => {
                let e = $(el);
            });
            $('script').filter(function() {
                return this.attribs.src !== undefined;
            }).each((idx, el) => {
                if(hasNoProtocol(el.attribs.src)) {
                    normalizePath(el, "src");
                }
            });
            $('link[rel=stylesheet]').filter(function() {
                return this.attribs.href !== undefined;
            }).each((idx, el) => {
                if(hasNoProtocol(el.attribs.href)) {
                    normalizePath(el, "href");
                }
            });
        }
        
        let exclusion = config.get("preprocessOptions.shimLinkExcludeClasses");
        if(config.get("preprocessOptions.shimLinks")) {
            // insert shim helpers
            $('head').append(util.format('<script src="vscode-resource:/%s"></script>', path.join(_extPath, '/lib/jsdocViewIntegration.js').replace(/\\/g, "/")));

            // and a link style
            //! should I retrieve the cursor style for a default anchor?
            $('head').append(`<style>a[onclick] { cursor: pointer }</style>`);
        } else {
            // I should split them up, but I use shim helpers for more than just shims now
            $('head').append(util.format('<script src="vscode-resource:/%s"></script>', path.join(_extPath, '/lib/jsdocViewIntegration.js').replace(/\\/g, "/")));
        }

        $('a').filter(function() { 
            return this.attribs.href !== undefined;
        }).each((idx, el) => {
            let shimmed = false;
            if(config.get("preprocessOptions.shimLinks")) {
                // if this anchor isn't excluded
                if(!exclusion.reduce(function(acc, excl) {
                    if($(el).hasClass(excl)) {
                        return true;
                    } else {
                        return acc;
                    }
                }, false)) {
                    // replace all normal links with onclick references
                    if(hasNoProtocol(el.attribs.href)) {
                        insertShim(el);
                        shimmed = true;
                    }
                }
            }

            // temp testing
            if(exclusion.reduce(function(acc, excl) {
                if($(el).hasClass(excl)) {
                    return true;
                } else {
                    return acc;
                }
            }, false)) {
                if(!shimmed && config.get("preprocessOptions.fixAttributePaths")) {
                    if(hasNoProtocol(el.attribs.href)) {
                        normalizePath(el, "href");
                    }
                }
            }
        });

    } catch(e) {
        console.log("Something happened %s", e);
    }
    

    

    // $('a').filter(function() { 
    //     // This is specifically filtering to avoid navbar expansions/replacements in the menu of docstrap jsdoc.
    //     return this.attribs.href !== undefined && this.attribs.class.indexOf("navbar-brand") === -1;
    // }).each((idx, el) => {
    //     let e = $(el);
    //     let ap = e.attr('href');
    //     ap = ap.substring(ap.lastIndexOf(":")+1);
    //     let p = path.posix.relative(rp, ap);
    //     e.attr('href', null);
    //     e.attr("onclick", util.format("ss_shim_nav('%s')", p));
    // });

    // Scroll
    //$(document).ready(function() { 
    //document.getElementById("anchorTest").scrollIntoView(); });

    return $.html();
}
