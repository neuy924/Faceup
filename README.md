# Retouch (version 1)

A portrait retouching web app for personal use.

## Publish from an iPhone
1. In the Files app, tap retouch-v1.zip to unzip it.
2. In Safari on github.com, create a new repository (for example `retouch`). Public is required for Pages on a free plan. Tick "Add a README".
3. Settings > Pages > Source: **GitHub Actions**. Do this before step 5.
4. Add file > Upload files: select every file from the unzipped folder, then Commit.
5. Add file > Create new file. Name it exactly `.github/workflows/deploy.yml`, paste the contents of deploy.yml, then Commit.
6. Open the Actions tab and wait for a green tick. If it is red, copy the error into the chat.
7. Open https://YOURNAME.github.io/retouch/ in Safari, then Share > Add to Home Screen.

Do not upload any personal photos to the repository.

## How privacy works
- Photos are processed in the browser. The app has no upload code.
- The page's security policy only allows connections to its own web address. This blocks MediaPipe's usage logging.
- "Resume last edit" keeps one copy of the photo and edit in this app's browser storage. "Delete saved edit" removes it.
  Other web apps on the same YOURNAME.github.io address can in principle read that storage.

## Export
JPEG, quality 95, original pixel dimensions up to 50 MP (larger photos are scaled down).
Camera metadata (including location and capture date) is not copied. Colour is saved as standard sRGB,
so some wide-colour range from iPhone photos can be lost. HDR brightness data is not kept. Keep your originals.

## Components
@mediapipe/tasks-vision 1.2.3 and the Face Landmarker model (Google); jpeg-js 0.4.4 (licence is published with the app).
The publishing recipe downloads these.
