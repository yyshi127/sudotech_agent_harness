# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

English | [中文](README.zh.md)

Browser presentation for Xiaojing's local browser preference. It registers a standalone `settings.section` named “Browser Control”; it does not add a row to General settings and owns no browser process or durable data.

The plugin activates only for the `xiaojing` Client build profile on a loopback origin. It binds the Host-owned `xiaojing-browser-control` settings namespace, offers Edge and Chrome choices, and reports that the browser starts visibly, continues protocol-level DOM work while minimized, and uses a separate dedicated login profile for each browser. The Host plugin applies a saved choice after already accepted browser work settles.

Removing this package from the product composition removes the settings entry without changing Harness UI code. Removing the Host browser-control plugin as well removes the tool and its settings namespace. Dedicated profile files remain in user data until the user explicitly deletes them.

## Model Experience

None, as this browser-only settings plugin renders the Host-owned browser preference and registers nothing model-facing.

#### KV Cache effect

No direct effect; opening the page or selecting a browser does not alter a model request.

## Known Limitations and Deferred Work

- Chrome can be selected only when Google Chrome is installed; the Host never substitutes the other browser after a launch failure.
- A saved browser change waits for already accepted browser operations to settle and applies to the next operation.
- Protocol-level DOM automation continues while the browser is minimized, but native browser or system dialogs still require the separate computer-control capability.
