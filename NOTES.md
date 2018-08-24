
#{ ToDo


`Algorithmic Cleansing`

- Change `shimHTML` to be called `preprocessHtml` and...
  - clean up code, strip out dead code
  - wire in support for fixAttributesPaths2
    - remove old shim/fixAttributesPath code
- clean up settings
- clean up documentation in `Notes.md`, rename to `DESIGN.md` and move to `design/` directory.
- `getShimmedContent` and `loadJSDoc` are almost the exact same thing.  Should probably remove one and clean up the code.
  - even `getJSDocContent` is only slightly different from the other two.

- push up to git server
  - semver
- setup clone in extensions

- Build vscode extension to look for updates to other extensions from private servers, rather than from the Marketplace.  By settings have a list of extensions to look for, similar to a dependencies list in npm?

}

# Design Debates

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