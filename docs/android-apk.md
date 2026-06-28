# UdharBook Android APK/AAB with Trusted Web Activity

UdharBook can be packaged as an Android Trusted Web Activity (TWA) around the production PWA at `https://app.qrvcard.in`.

## Prerequisites

- Node.js and npm
- Java JDK 17 or a version supported by the installed Android build tools
- Android Studio with Android SDK, platform tools, and build tools
- A physical Android device or emulator for testing
- Production access to deploy files under `https://app.qrvcard.in/.well-known/`

Set `JAVA_HOME` and `ANDROID_HOME` for the installed JDK and Android SDK. Add the Android SDK `platform-tools` directory to `PATH`.

## Install Bubblewrap

```powershell
npm install --global @bubblewrap/cli
bubblewrap doctor
```

Resolve any missing JDK or Android SDK items reported by `bubblewrap doctor` before continuing.

## Initialize the Android project

Create the generated wrapper outside this repository, or in the ignored `android-twa/` directory:

```powershell
New-Item -ItemType Directory android-twa
Set-Location android-twa
bubblewrap init --manifest=https://app.qrvcard.in/manifest.json
```

Recommended values during initialization:

- Application name: `UdharBook`
- Launcher name: `UdharBook`
- Package ID: choose the final immutable Android package ID, for example `in.qrvcard.udharbook`
- Host: `app.qrvcard.in`
- Start URL: `/`
- Display mode: `standalone`
- Theme color: `#0f766e`
- Background color: `#f8fafc`

The package ID cannot be changed after publishing without creating a different Play Store application.

## Signing key

Bubblewrap can create or use an Android signing key during initialization/build. Store the keystore and passwords in a secure password manager or CI secret store.

Never commit these files:

- `*.jks`
- `*.keystore`
- signing passwords or private keys
- generated signing configuration containing secrets

For Google Play App Signing, use the SHA-256 fingerprint of the **App Signing certificate** shown in Play Console for the Play-distributed build. A locally installed APK uses the certificate that signed that APK.

Inspect a local signing certificate with:

```powershell
keytool -list -v -keystore .\android.keystore -alias android
```

Use the real `SHA256` value printed by `keytool`; do not invent or reuse a fingerprint from another app.

## Digital Asset Links

Android verifies that the website owns the Android package through:

`https://app.qrvcard.in/.well-known/assetlinks.json`

The repository initially serves a valid empty array from `public/.well-known/assetlinks.json`. This deliberately contains no fake fingerprint. Before testing full-screen TWA mode, replace it with the statement generated for the final package ID and real signing certificate:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "YOUR_FINAL_PACKAGE_ID",
      "sha256_cert_fingerprints": ["YOUR_REAL_SHA256_SIGNING_CERTIFICATE_FINGERPRINT"]
    }
  }
]
```

The deployed response must be public without login, return HTTP 200, use `Content-Type: application/json`, and must not redirect. Verify it before building:

```powershell
curl.exe -i https://app.qrvcard.in/.well-known/assetlinks.json
```

You can also verify the relationship with Google's Digital Asset Links API after deployment. If both direct APK installs and Google Play builds use different signing certificates, include both real SHA-256 fingerprints in the array.

## Build APK and AAB

From the generated Bubblewrap project:

```powershell
bubblewrap build
```

Bubblewrap builds the signed Android artifacts supported by the installed toolchain. Use the generated APK for device testing and the generated AAB for Play Console upload. Artifact names can differ by Bubblewrap version; check the command output and generated project directory.

After changing the web manifest, update the wrapper before rebuilding:

```powershell
bubblewrap update
bubblewrap build
```

Do not commit generated APK/AAB files, the generated Android project, or signing material to this repository.

## Production checks

1. Open `https://app.qrvcard.in/manifest.json` and confirm it returns the UdharBook manifest without login.
2. Confirm the 192px, 512px, and maskable icons load successfully.
3. Confirm `assetlinks.json` contains the final package ID and real signing fingerprint.
4. Install the signed APK and confirm it opens without the browser address bar after Digital Asset Links verification.
5. Sign in and test navigation, logout/login, back navigation, and app relaunch.
6. Test customer visit punch on a physical device. Allow precise location and confirm inside/outside geofence handling.
7. Test WhatsApp/native sharing and its clipboard fallback.
8. Test camera/gallery file selection and upload.
9. Test light/dark mode, keyboard input, rotation, and display cutout/safe-area spacing.
10. Test offline/reconnect behavior. API and live location routes intentionally remain network-only.

## TWA troubleshooting

- Browser UI appears: Digital Asset Links did not verify. Check package ID, signing fingerprint, HTTP status, content type, and redirects.
- GPS is blocked: confirm Android location is enabled, Chrome has location permission, the site permission is allowed, and the page is served over HTTPS.
- Old manifest or icon appears: update the Bubblewrap project, rebuild it, and clear the previous app/site cache on the test device.
- Upload picker does not open: test on current Chrome/Android System WebView and verify the page uses a standard file input.
