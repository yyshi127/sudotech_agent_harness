# @deepseek-ai/dsh-client-ui-xiaojing-browser-control

English | [中文](README.zh.md)

Browser-control presentation for Xiaojing. It registers a standalone `settings.section` named “Browser Control”; it does not add a row to General settings and owns no browser process or durable data.

The plugin activates only for the `xiaojing` Client build profile on a loopback origin. It reports Microsoft Edge as the fixed automation browser and explains that Edge starts visibly, continues protocol-level DOM work while minimized, and uses a dedicated persistent login profile.

Removing this package from the product composition removes the settings entry without changing Harness UI code. Removing the Host browser-control plugin as well removes the tool. The dedicated profile remains in user data until the user explicitly deletes it.

## Model Experience

None, as this browser-only settings plugin renders static product guidance and registers nothing model-facing.

#### KV Cache effect

No direct effect; opening this settings page does not alter a model request.

## Known Limitations and Deferred Work

- Protocol-level DOM automation continues while Edge is minimized, but native browser or system dialogs still require the separate computer-control capability.
