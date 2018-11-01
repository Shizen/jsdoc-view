/**
 * @file The `extension.js` file is the standard hook-in file for a vscode extension.
 * @author Shin <shin@shinworks.co>
 * @todo document the various typedefs in this project, particularly `_jsdocViewState`
 */

/**
 * @module jsdoc-view
 * @public
 * @desc
 * The jsdoc-view is a vscode extension which adds support for viewing jsdoc generated documentation
 * within vscode.  
 * @algorithm
 * Currently, this extension works by preprocessing and sanitizing each jsdoc generated page live, in
 * memory to allow it to work within the context of a vscode webview panel.  Communication between 
 * vscode and the jsdoc page is maintained via posted `message` events (this is standard practice).
 * 
 * This extension currently has special handling on both sides for performing a full text search and
 * for openning a file to a particular element.  
 */

// jshint esversion: 6
const vscode = require('vscode');
const path = require('path');
const util = require('util');
const cp = require("child_process");
const fs = require('fs');
const cheerio = require('cheerio');

/**
 * This function is the "root" hook for this extension within vscode.  This function registers its handlers for the 
 * commands declared in this extension's `package.json`.
 * @protected
 * @param {object} context The vscode provided context object.
 */
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

/**
 * Standard deactivate hook.
 * @protected
 */
function deactivate() {
}
exports.deactivate = deactivate;

/**
 * This function creates the jsdoc-view webview panel for the current project.  Currently, the project is defined as the
 * the root project for the open workspace--this is very bad :).  I need to update the algorithm by which this is 
 * determined.
 * @protected
 * @param {object} _jsdocViewState The jsdocView State object
 * @param {object} _context The retained context object with which this extension was originally activated.
 * @param {object} _editor If defined, the active editor for which this view is being created.
 */
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

/**
 * This is the message routing function which handles sending messages from the extension to the client
 * webview.  Besides acting as an encapsulating chokepoint, this function also ensures that any messages
 * sent before the view is ready are instead queued to be sent "later".  See also 
 * {@link module:jsdoc-view.createJsDocView} for details (`onDidReceiveMessage`).
 * @param {object} _message The message being sent to the webview panel.
 * @param {object} _jsdocViewState The state object for this extension.
 */
function postMessage(_message, _jsdocViewState) {
    // So it doesn't dispose of the panel when it goes out of view.
    if(_jsdocViewState.panelReady) {
        _jsdocViewState.panel.postMessage(_message);
    } else {
        _jsdocViewState.messages.push(_message);
    }
}

/**
 * This function handles executing jsdoc generation.  This function includes basic debouncing and
 * will fail ("silently") if the command is already in process.  
 * @protected
 * @param {object} _state The jsdocViewState object.
 * @todo Add a return value indicating success or failure.
 * @todo Where is the error handling?!?
 */
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

/**
 * This is the function called to generate the initial page when jsdoc-view "launches" its viewer.
 * See {@link module:jsdoc-view.loadJSDoc} for details on the function which generates 
 * pages navigated to by links.
 * @protected
 * @param {object} _panel The webview panel
 * @param {string} _extPath The path to this extension
 */
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
            _panel.webview.html = preprocessHtml(data.toString(), _extPath);
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

/**
 * This is the function which is called to shim content which is loaded in the background. See 
 * {@link module:jsdoc-view.getJSDocContent} for details on the generator function for the initial content,
 * and {@link module:jsdoc-view.loadJSDoc} for navigation triggered load/shimming.
 * @param {string} _urlRelPath url base
 * @param {function} _cbFn Callback function
 * @param {string} _extPath Path to this extension
 */
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
            _cbFn(preprocessHtml(data.toString(), _extPath));
        });
    } catch (e) {
        vscode.window.showErrorMessage(util.format("jsdocView encountered an error shimming %s : `%s`", _urlRelPath, e.message));
    }
}

/**
 * This function is the handler for load requests for local html files generated by the webview panel.  See
 * See {@link module:jsdoc-view.getJSDocContent} for details on initial content generation.
 * @param {object} _panel The webview panel object
 * @param {string} _fileName The rel-path filename being requested
 * @param {string} _extPath The path to this extension
 * @param {string} _scrollToPoint The name of the anchor to which the view should be scrolled upon display.
 */
function loadJSDoc(_panel, _fileName, _extPath, _scrollToPoint) {
    const config = vscode.workspace.getConfiguration('jsdocView');
    const docDir = config.get("docDir");
    let p = path.join(vscode.workspace.rootPath, docDir, _fileName);
    fs.readFile(p, (err, data) => {
        if(err) {            
            vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", err.message));
        }
        _panel.webview.html = preprocessHtml(data.toString(), _extPath);
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
 * How terrible is it that I pass the entire file on the stack?!?  I should really box it.  Look, I've even said
 * it twice.
 * @param {string} _sHtml A buffer with the sources to process.
 * @param {string} _extPath The path to this extension 
 * @param {string} _docPath "Optional", this is the path to the documentation this source comes from.  This
 * is used to resolve relative [file] path references and links in the source html.  If not provided, 
 * `preporcessHtml` will "guess" based on current settings.
 */
function preprocessHtml(_sHtml, _extPath, _docPath) {
    const $ = cheerio.load(_sHtml);
    const config = vscode.workspace.getConfiguration('jsdocView');
  
    // All of this made worse by path.posix.join/resolve/etc. not converting path delimeters properly (which it purports to do)
    let projectRootPath = vscode.workspace.rootPath;
    let drive = "";
    if(process.platform === "win32") {
      projectRootPath = projectRootPath.replace(/\\/g, "/");
      drive = projectRootPath.substring(0, projectRootPath.lastIndexOf(":")+1);
      projectRootPath = projectRootPath.substring(projectRootPath.lastIndexOf(":")+1);
    }
  
    // Derive best guess documentation directory if none provided.
    if(_docPath === undefined) {
      // Let's guess -- This will be replaced later by minimally a package.json check
      let docDir = config.get("docDir");
      _docPath = path.posix.join(projectRootPath, docDir);
    }
  
    
    //#region Helper functions
    // I could make a preprocess class/object and decorate it with these functions, or I could 
    // simply pull them out of here.  Only `normalizePath()` captures context.  Right now these are effectively
    // private functions of `preprocessHtml()`
  
    /**
     * @desc
     * This is a simple helper function that tests if a given url has a scheme or not.
     * @param {string} _url A url
     * @algorithm
     * This does a simple test for a ":" from the front like `^[\w-_]+:`.  I didn't look up the RFC, but afaik,
     * this will match only a scheme.  An authority would require `//`  before the `:`.
     * @notes
     * So I knew it would be wasteful, but it turns out its requirements cause it to be fail prima facia.
     * let url = new URL(_url, docDir);
     */
    function hasNoScheme(_url) {
      if(/^[\w-_]+:/.test(_url)) {
          return false;
      }
      return true;
    }
  
    /**
     * @desc
     * Currently, we read docs from disk.  Until we decide to serve them from an on-demand server, the policies of
     * vscode's webviewAPI require that we access local resources via the `vscode-resource:` scheme.  This helper
     * function will take a relative path and convert it to a fully resolved vscode-resource path.
     * @param {object} _el An element
     * @param {string} _sAttr The attribute containing a relative path to normalize
     */
    function normalizePath(_el, _sAttr) {
        let el = $(_el);
        let url = el.attr(_sAttr);
  
        // The trouble here is, relative to what, potentially.
        let p = path.posix.join(_docPath, url);
        p = util.format("vscode-resource:/%s%s", drive, p);
        el.attr(_sAttr, p);
    }
  
    /**
     * @desc
     * This function replaces the `href` of an element with an onclick shim function to send a message to
     * the vscode "server" to navigate to the requested url.
     * @deprecated
     * These shims should no longer be necessary.  PreprocessHtml utilizes a broader reaching listener on 
     * the click process that looks for applicable hrefs on anchors and performs the same message passing
     * that this shim did.  In fact, I believe the shim has been removed from `jsdocViewIntegration.js`.
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
      // Add in our integration "library"
      $('head').append(util.format('<script src="vscode-resource:/%s"></script>', path.join(_extPath, '/lib/jsdocViewIntegration.js').replace(/\\/g, "/")));
  
      // Content Security Policy
      if(config.get("preprocessOptions.replaceCSP")) {
        let policy = config.get("preprocessOptions.useCSPolicy");
        //<meta http-equiv="Content-Security-Policy"
        let csp = $('meta[http-equiv=Content-Security-Policy]');
        if(csp.length >0) {
          csp.attr('content', policy);
        } else {
          policy = policy.replace(/'/g, "\'");
          $('head').prepend(util.format('<meta http-equiv="Content-Security-Policy" content="%s">', policy));
          // $('head').prepend('<meta http-equiv="Content-Security-Policy" content="default-src vscode-resource: https: http: data:; img-src vscode-resource: https: http: data:; script-src \'unsafe-inline\' \'unsafe-eval\' vscode-resource: http:; style-src \'unsafe-inline\' vscode-resource: https: http:;">');
        }
      }
  
      // Process attributePath fixup
      // This walks the structure in the settings to do the fixup.  The old scheme basically hardcoded the defaults.
      if(config.get("preprocessOptions.fixAttributePaths2")) {
        let fixupDescriptor = config.get("preprocessOptions.fixAttributePaths2");
        for(let _tag in fixupDescriptor) {
          let attrs = fixupDescriptor[_tag].attrs;
          let inclFilter = fixupDescriptor[_tag].ifHasClass || [];
          let exclFilter = fixupDescriptor[_tag].exceptHasClass || [];
  
          let tag = _tag;
          if(fixupDescriptor[_tag].tag !== undefined) {
            tag = fixupDescriptor[_tag].tag;
          }
          let sel;

          // I could have two paths, one without a `.filter` in the event there were no filters.  This would be (much) more verbose, but better perf.
          attrs.forEach((_attr) => {
            if(fixupDescriptor[_tag].selector !== undefined) {
              sel = util.format("%s[%s]%s", tag, _attr, fixupDescriptor[_tag].selector);    // Yeah, this is kinda lame
            } else {
              sel = util.format("%s[%s]", tag, _attr);
            }
            $(sel)
              .filter(function() {
                // Logically we're doing this...
                // let inc = true;
                // if(inclFilter) {
                //   inc = hasClass(this.attribs.class, inclFilter);
                // }
                // if(declFilter && hasClass(this.attribs.class, declFilter)) {
                //   inc = false;
                // }
                // But for perf reasons...
                let inc = inclFilter.length === 0;
                let cls = this.attribs.class !== undefined? this.attribs.class.split(" ") : [];    //?
                for(let idx=0; idx < cls.length; idx++) {
                  if(inclFilter.indexOf(cls[idx]) !== -1) {
                    inc = true;
                  }
                  if(exclFilter.indexOf(cls[idx]) !== -1) {
                    return false;
                  }
                }
                return inc;
              }).each((_idx, _el) => {
                if(hasNoScheme(_el.attribs[_attr])) {
                  normalizePath(_el, _attr);
                }
              });
          });
        }
      }
  
      return $.html();
  
    } catch(e) {
      vscode.window.showErrorMessage("jsdocView encountered an error during preprocessing... (`%s`)", e.message);
    }
  }