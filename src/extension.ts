import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	const provider = new ClippyViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('clippyView', provider)
	);

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(() => {
			const errors = getAllErrors();
			provider.updateErrors(errors);
		})
	);
}

function getAllErrors(): { message: string, line: number }[] {
	const errors: { message: string, line: number }[] = [];
	for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
		for (const d of diagnostics) {
			if (d.severity === vscode.DiagnosticSeverity.Error) {
				errors.push({
					message: d.message,
					line: d.range.start.line + 1
				});
			}
		}
	}
	return errors.slice(0, 10);
}

class ClippyViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')]
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'getSoundPref') {
				const soundEnabled = this._context.globalState.get('soundEnabled', false);
				webviewView.webview.postMessage({ command: 'soundPref', soundEnabled });
			}
			if (message.command === 'saveSound') {
				await this._context.globalState.update('soundEnabled', message.enabled);
			}
			if (message.command === 'jumpToError') {
				jumpToError(message.line);
			}
		});

		setTimeout(() => {
			const errors = getAllErrors();
			this.updateErrors(errors);
		}, 1000);
	}

	updateErrors(errors: { message: string, line: number }[]) {
		if (!this._view) { return; }
		this._view.webview.postMessage({ command: 'errorsUpdated', errors });
	}

	getHtml(webview: vscode.Webview): string {
		const htmlPath = path.join(this._context.extensionPath, 'media', 'clippy.html');
		let html = fs.readFileSync(htmlPath, 'utf8');
		const jqueryUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'jquery.min.js')
		);
		const libUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'clippy-lib.js')
		);
		const agentsDirUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media')
		);
		html = html.replace('JQUERY_SRC', jqueryUri.toString());
		html = html.replace('LIB_SRC', libUri.toString());
		html = html.replace('AGENTS_SRC', agentsDirUri.toString() + '/');
		return html;
	}
}

function jumpToError(line: number) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) { return; }
	const position = new vscode.Position(line - 1, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position));
}

export function deactivate() {}