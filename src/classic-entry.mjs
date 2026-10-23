import * as sdk from './index.mjs'

window.MicroSdk = Object.freeze({ ...sdk, sdkVersion: sdk.SDK_VERSION })
