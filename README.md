# Marginalia for Android

Paste a YouTube lecture link, tick topics, and get short study notes (tables, formulas, diagrams) written by Gemini, then save them as a PDF. Everything runs **on the phone**: there is no server. The app reads YouTube's auto-generated captions itself and talks to Gemini directly, so your key never leaves your phone except to go to Google.

This is a Capacitor app (a web app packaged as an Android app).

## Get the APK, no installs needed (about 10 minutes)

GitHub builds the APK for you, for free.

1. Make a free account at https://github.com
2. Click **+** (top right) then **New repository**. Name it `marginalia`, choose **Private**, click **Create repository**.
3. Click **uploading an existing file**. Open the `marginalia-android` folder on your computer, select **everything inside it** and drag it into the page. Make sure the `.github` folder goes up too. Click **Commit changes**.
   - If `.github` did not upload: click **Add file, Create new file**, type the name `.github/workflows/build-apk.yml`, paste the contents of that file from this folder, and commit.
4. Click the **Actions** tab. A run called **Build Android APK** starts by itself. Wait 5 to 10 minutes for the green tick. (A red cross: open the run, copy the red error text and send it to me.)
5. On your **phone**, open Chrome, go to your repository, tap **Releases** (right side), and download **Marginalia.apk**.
6. Open the downloaded file. Android will ask to allow installing from Chrome: allow it, then tap Install.

## First launch

A sheet slides up asking for your Gemini key. Get a free one at https://aistudio.google.com/apikey, paste it, tap **Load** next to Model, choose one with "flash" in the name, and tap Save.

## Using it

1. **Lecture tab:** paste the link, tap **Get topics**, tick topics, tap **Make notes**.
2. **Notes tab:** switch **Full | Short**, change text size with **A− / A+**, tap **Make shorter** for tables and one formula sheet, then **Save PDF**. A share sheet opens so you can save to Files or Drive, or send it on WhatsApp.
3. The Android back button goes from Notes back to Lecture, then closes the app.

Keep the app open while notes are being written. If you switch away for a long time, Android may pause it.

## Build it yourself with Android Studio instead

You need Node.js 20+, Android Studio and Java 21.

```
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio choose **Build, Build Bundle(s) / APK(s), Build APK(s)**.

## If something goes wrong

- **"Couldn't get the captions automatically".** Use the paste box that appears (steps are on screen), or tap Try downloading again. Open Technical details to see which route YouTube blocked.
- **"Gemini can't find this model".** Open settings, tap Load, and choose a model from the list.
- **Rate limit.** Free keys allow a few requests a minute. Wait, then tap Retry.
- **Hindi in the PDF looks off.** The PDF is a picture of the page, so it matches what you see on screen. If a Hindi letter looks wrong on screen, it will be wrong in the PDF too.

## Files

```
src/engine.js      does what the desktop server did, on the phone
src/youtube.js     video details and captions (Android app route, iOS app route, web page)
src/gemini.js      Gemini calls and retries
src/prompts.js     the instructions given to Gemini
src/pdf.js         PDF pages and the Android share sheet
src/main.js        the screens
web/               index.html and style.css
test/run.mjs       offline checks (npm test)
.github/workflows  the free cloud build
```

This build was checked with an offline test of the logic. It has not been run on a real phone yet, so tell me what you see and I will fix it.
