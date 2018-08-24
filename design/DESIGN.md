
#{ ToDo

- `getShimmedContent` and `loadJSDoc` are almost the exact same thing.  Should probably remove one and clean up the code.
  - even `getJSDocContent` is only slightly different from the other two.

- push up to git server
  - semver
- setup clone in extensions

- Build vscode extension to look for updates to other extensions from private servers, rather than from the Marketplace.  By settings have a list of extensions to look for, similar to a dependencies list in npm?

}

# Design Debates

!{ Total aside
Now that I've been using this pattern more, this isn't exactly a DESIGN document as much as it is a dev journal.  Perhaps I should rename it.
}

## The Service model

The question is wether to create a separate detached process to handle processing (similar to how language services are handled) and send messages back and forth to it to handle html preprocessing and to do keyword look ups.

Without reading more about Langauge services, the idea here would be to spawn a detached process that would shut itself down after a certain period of inactivity, and would take requests over a named pipe, possibly keyed to either its or its launcher's pid, and would basically do the preprocessing/shimming of pages, and calculations like, which set of docs to view and what to display, anchors, etc. on behalf of the extension and just route the results back to here.

[extension]:

- Open webview with params (e.g. `localResourceRoots:`), basically specifying which jsdoc cluster to display
- Take and pass to webview messages (e.g. `search` or `scrollTo`)

[provider]:

- Take an open request in a file on a word and figure out which jsdoc cluster to work with, and what lookup to call (this is potentially the wrong way to do this).  
  This is the basis of advanced contextual binding/intellisense

# Notes

## Another webviewPanel bug

So, when a webviewPanel is no longer visible, it gets destroyed.  It does not, however, call dispose.  It then is silently recreated when it comes into focus again.  This means that the panel's contents are reloaded and are temporarily unavailable (vis a vis messages).  This is an additional issue to `message ready` below, because this recurs every time the webview panel is hidden.  There aught to be an event or trigger.  

What I am doing currently is a hack.  If I attempt to send a message to a panel which is not visible (you can test that), then I know it isn't ready, and I reset it's ready state and queue the message.  This still leaves a race condition hole where if a message gets queued when a panel is loading but after it has been revealed, this check will not trigger and the message will be lost.

## `message ready`

I have uncovered a architectural flaw in the webview system where, basically, there is no mechanism that allows an extension to know when a webview is ready.  Instead, I will need to role my own.  This is basically going to be a two part problem.  First, I need to have the webview notify the extension when it is ready (in document.ready).  Second, I need to wrapper `_panel.webview.postMessage` such that any messages sent to the webview before its ready are instead put onto a queue and get sent, instead, when it receives the webviewReady message.

## The `docstrap search`

Docstrap conducts its search in a frame.  Why?  I have no idea.  This frame loads up some sources of the file, does a search in a dataUrl which has the full text in it (ok, so that's why, but...).  When it retrieves an answer it posts it back to root frame, despite cross-domain issues (at least *I* have cross-domain issues trying to talk between these frames, I don't know the rules by which some operations/fields are accessible but others are not in chrome).

Less importantly, docstrap creates the iframe in client on document ready.  It attaches a listener to the faux-submit button and sends messages (e.g. `postMessage`) between the button, the iframe and back.  The actual results are displayed in a results `div` on the main page which is populated dynamically.  The iframe is never dispayed or interacted with, afaik, it is just a mechanism for deferred loading.

## Anchors & Gotos

We can within an iframe grab an element and `scrollIntoView()` it.

		$("a[name=" + _anchor + "]")[0].scrollIntoView();

I also know, at least for docstrap, that it has a lib which on opening a source file sets a specific anchor pattern for each source line therein.  This is *probably* a jsdoc convention, and not specific to docstrap.  This is accomplished by a `document.ready` based decorator than sweeps the file adding anchors to every source line (as I recall).

  $('#active-frame').contentWindow.scrollTo(0,300)
  $('#active-frame').contentWindow.scrollY

Works, but only from the context of the debugger, which is working from a global context.  In `shim-helpers.js`, we have a different scope of access.  There we need to use `window.self`.  If defined, this is the `contentWindow` for the current document.  `window.top` is the root `window`.  If undefined there is only one `window`.  I'm not sure if all the browsers use this pattern, but it holds for the webkit used by atom/electron/vscode.  Thus...

  window.self.scrollY
  window.self.scrollTo(0, 300)

# Gotchas

## Paths in createWebView

Normal paths did not work.  You have to run them through `vscode.Uri.file`.
  
    let workspacePath = vscode.Uri.file(vscode.workspace.rootPath);
    let extentionPath = vscode.Uri.file(context.extensionPath);

    if(jsdocViewState.panel === undefined) {
        jsdocViewState.panel = vscode.window.createWebviewPanel(
            'jsdocView',
            "JSDoc View",
            columnToShowIn,
            { enableScripts: true, localResourceRoots: [
                workspacePath,
                extentionPath
                // vscode.workspace.rootPath
                // path.join(vscode.workspace.rootPath, "docs"),
                // path.join(vscode.workspace.rootPath, "node_modules/ink-docstrap/template/static/styles")
            ] }
        );

## Serializer didn't work...

    // Neither of these work.
    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('jsdocView', (_panel, _state) => {
        jsdocViewState.panelReady = false;
    }));
    vscode.window.registerWebviewPanelSerializer('jsdocView', (_panel, _state) => {
        jsdocViewState.panelReady = false;
    });

    // with the following as activationEvents in `package.json`
    "onWebviewPanel:jsdocView"
  
## Old Experiments

    function shinTest(_panel) {
        let t = path.join(vscode.workspace.rootPath, "test.html");
        fs.readFile(t, (err, data) => {
            if(err) {            
                vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", err.message));
            }
            _panel.webview.html = data.toString();
        });
    }

    function loadTest(_panel, _fileName) {
        let t = path.join(vscode.workspace.rootPath, _fileName);
        fs.readFile(t, (err, data) => {
            if(err) {            
                vscode.window.showErrorMessage(util.format("jsdocView encountered an error: %s", err.message));
            }
            _panel.webview.html = data.toString();
        });
    }

## original "shimHtml()" code

Along with the code below, the following settings were removed from this extension's package.json...

  ,
  "jsdocView.preprocessOptions.fixAttributePaths": {
      "type": "boolean",
      "default": true,
      "description": "[deprecated]: Set to true if you want the jsdocView preprocessor to change all attribute paths in script, link & anchor tags without a protocol to use `vscode-resource:`"
  },
  "jsdocView.preprocessOptions.shimLinks": {
      "type": "boolean",
      "default": true,
      "description": "[deprecated]: Instructs the preprocessor to shin anchor link tags with a function which will allow them to work in Visual Code."
  },
  "jsdocView.preprocessOptions.shimLinkExcludeClasses": {
      "type": "array",
      "default": [
          "dropdown-toggle"
      ],
      "description": "[deprecated]: A list of anchor classes for which no shims should be inserted."
  }

`shimHtml()` :

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
