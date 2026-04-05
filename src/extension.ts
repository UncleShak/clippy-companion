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
			if (message.command === 'saveKey') {
				await this._context.secrets.store('anthropicKey', message.key);
				webviewView.webview.postMessage({ command: 'keysaved' });
			}
			if (message.command === 'getKey') {
				const key = await this._context.secrets.get('anthropicKey');
				const savedMode = this._context.globalState.get('smartMode', false);
				const soundEnabled = this._context.globalState.get('soundEnabled', false);
				webviewView.webview.postMessage({
					command: 'keyResult',
					hasKey: !!key,
					savedMode: savedMode,
					soundEnabled: soundEnabled
				});
			}
			if (message.command === 'saveMode') {
				await this._context.globalState.update('smartMode', message.mode);
			}
			if (message.command === 'saveSound') {
				await this._context.globalState.update('soundEnabled', message.enabled);
			}
			if (message.command === 'askClippy') {
				const key = await this._context.secrets.get('anthropicKey');
				if (!key) { return; }
				const reply = await askClaude(key, message.error);
				webviewView.webview.postMessage({ command: 'clippyReply', text: reply });
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

async function askClaude(apiKey: string, errorMessage: string): Promise<string> {
	try {
		const prompt = "You are Clippy, the retro Microsoft Office assistant, helping a developer. " +
			"They have this error: " + errorMessage + ". " +
			"React in Clippy's personality - friendly, encouraging - but do NOT give the fix. " +
			"Just nudge them toward what to look at. Max 2 sentences. End with a paperclip emoji.";

		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 150,
				messages: [{ role: 'user', content: prompt }]
			})
		});
		const data = await response.json() as any;
		return data.content?.[0]?.text ?? "Something needs your attention!";
	} catch {
		return "My brain glitched! But check that error!";
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