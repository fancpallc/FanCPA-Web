# Drive setup Option B

Option B uses OAuth with `calendar` and `drive.file` scopes. This setup ensures that client folders are created under a specific root folder you own, shared with the client as a `Writer`.

## Setup Steps

1. **Create Root Folder**: In your Google Drive, create a folder (e.g., `FanCPA Clients`).
2. **Get Folder ID**: Open the folder in your browser. The URL will look like `https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jK...`. Copy the `1A2b3C4d5E6f7G8h9I0jK...` portion.
3. **Configure Environment**: Add this ID to your `.dev.vars` (for local dev) and to your Cloudflare Pages project secrets (for production) using the variable name `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
4. **Grant Access**:
   - Ensure the Google OAuth Client used by the app has `drive.file` scope enabled.
   - The app will now create folders inside your specified root folder when a new client booking is confirmed.
5. **Share with Client**: The app automatically shares the newly created client folder with the client's email address as a `Writer`.
