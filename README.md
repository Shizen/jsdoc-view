# jsdoc-view README

Introduces the command `jsdocView.start`, which will open up the jsdoc docs for this project.  If the docs do not exist, jsdocView will generate them using the npm script specified in the `jsdocView.buildScript` setting (defaults to `build-docs`).

## Features

- Generate the jsdoc documentation for your project from within vscode.
- Bring up a webview within vscode to display the jsdoc documentation for the current project
  - [Not Implemented] Synchronized between active source file in the text editor and the webview

### Possible Future Features

- Allow the setting of a custom CSP for the jsdocView panel.
- Backwards hook-in -- shim source code links to open the texteditor in the appropriate location.

## Requirements

This extension assumes the presence of the `jsdoc` module, although it doesn't call it directly.  It does attempt to generate jsdoc documentation indirectly via an npm script (by default it assumes this script is called `build-docs`, e.g. `npm run-script build-docs`).

## Settings

`jsdocView.buildScript`
:   Specifies the npm script to run in order to generate the documentation.

`jsdocView.docDir`
:   The direction into which the documentation will be generated.

! jsdocView.preprocessOptions

`preprocessOptions.replaceCSP`
:   Will cause the jsdocView processor to replace the `<meta Content-Source-Policy...>` tag with one it thinks will allow more jsdoc sources to function.

`preprocessOptions.shimLinks`
:   If true, the preprocessor will replace the `href` values on `<a>` tags with relative paths with an `onclick` shimmed function which will message vscode itself to update the webview's location.

`preprocessOptions.shimLinkExcludeClasses`
:   An array of class names any of which if present on a given tag indicate that the tag *should not be shimmed*, even if it would otherwise qualify.  This allows one to specify overrides for tags which may be shimmed by other functions (like the navbar in docstrap).

`preprocessOptions.fixAttributePaths`
:   Will cause the jsdocView preprocessor to replace the `href` and `src` attribute values of `<script>`, `<link>` and `<a>` tags which do not specify a protocol with an absolute pathed value with the `vscode-resource:` protocol.  Relative paths are assumed to be in the `docsDir`.


## Known Issues

- The tag "override" scheme with `preprocessOptions.fixAttributePaths2` is not actually necessary for what I originally envisioned it for, but having coded it, I'm leaving it in place for the interim, in case another use for it emerges.

- GetContext.  In the example I have been using, I have only one repos/project, one package.json and one set of jsdocs.  But, in `roi` for instance, I have many.  This issue here is that I should be looking for the nearest encapsulating package.json and trying to get docs from it, first (absent the more advanced topic of semantic integration).  For the purposes of this issue, this is a "by file" question.  I.e. based on the currenly openned/focused file, which is the closest package.json, and open its docs, if any.  This makes settings more complicated because different packages may have different jsdoc settings for location and generation, but our workspace has only one (based on the root level workspace).  This implies that I should somehow read these settings out of the `package.json` of the nearest encapsulating project--doc generation script, doc location.  

- add img processing to preprocessor
- settings need to be redone
  - We need to remove the shim references, as we are no longer shimming
- search wire up does not work when webView is in background or not open--The window is destroyed and thus can not receive messages.  I need to create a handshake between the render thread and the extension so it knows when the webview is ready for messages before it sends the search command.

- The anchor scrollTo helper function utilizes `scrollIntoView` which appears to be slightly off in its calculations, as it doesn't factor in the navbar.  This is a polyfill/patch type issue as there are many circumstances that might cause this problem, and an ideal solution would detect them and offset as appropriate.  Since I do not have an enumeration of the possible issues, it's hard to do a reasonable patch.  I am currently doing an "arbitrary" 65px offset.  I could calculate the exact cut out for the navbar for docstrap, but as I said, this doesn't feel like it would particularly map to other templates, layouts and styles.
- contextually bind textEditor to jsdocView (to scrollTo the relevant entry).  
    This is a two part problem.
  1. I need to identify what semantic element I am on or near within the active text editor.  
      Currently, the closest I've gotten is that I know what word I'm on :/.  Get the semantic information is even harder, because vscode does not appear to expose any semantic information on the current document to the extension system.
  2. I need to determine which file to open for a given reference (which jsdoc file that is).
      Given the layout of jsdoc files, naming structure, etc.  This seems potentially difficult.

    Now one thing I do have access to is the source ranges from jsdoc doclets as they are built.  So it is possible I could build a mapping file (similar to, but not literally the same as a debugger mapping file), to map ranges in the source code with jsdoc files.  This seems reasonable.

  - The selection of jsdoc source is currently very simplistic (it takes the docs for the current project).  This could be augmented to look more carefully at the governing `package.json` first.

- Change configuration options
  - Allow non-npm based script for jsdoc generation
  - ? Do we need jsdoc generation options to vary by active file?  Doesn't seem like it.
- Inline(?) style for shimmed links should, perhaps, grab their style information from the default css for an anchor.  (this probably requires live "interrogation" within the browser).  (At the moment, I do a simple patch up).

- Refactoring html pages for display in vscode's webview.
  - The href/src replacement rules currently only hit `<link>`, `<a>`, and `<script>` tags.  I could generically grab all href and src tags (so, for instance, images, etc.).  
    - The rule for when to replace the attribute's value is based on that value being a relative link (without a protocol specification).  Given the issues with window's file references, the test for a protocol is a bit fragile.  For instance, while it will reject `/c:/test.tmp` as a path with a protocol, it will accept `c:/test.tmp` as a path with protocol `c`.  vscode does not accept "proper" urls of the form `vscode-resource://c:/test.tmp`.  
    - I need to verify that the path in question is relative.
    - We do not fix-up paths for non-windows platforms.

See also [the extensions KB](P:/_KnowledgeBase/_Applications/Visual%20Code/Extensions.md#WIP) for its extended list of WIP issues.

## Release Notes

- I have removed shims from preprocessing.  All links go through an event capture mechanism now, which intercepts and reroutes anchor links to local path relative urls.  This is in alpha and may have bugs.