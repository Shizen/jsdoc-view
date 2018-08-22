
var vscode = acquireVsCodeApi();

function ss_shim_nav(_url) {
	vscode.postMessage({
		command: "navigate",
		text:_url
	});
}