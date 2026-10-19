# Put Grenada Farm Exchange online with Render and GoDaddy

This guide takes you from the zip file to a working site on your own domain. Set aside one to two hours the first time. You need:

- A GitHub account (free).
- A Render account. Render is a paid service for real use. Check its current prices and use a card you control.
- Your domain at GoDaddy.
- An email address and password you want for your administrator account. Use a long password.

Never send passwords or secret keys to anyone in chat or email, including to Claude.

## Step 1. Put the project on GitHub

1. Unzip `grenada-farm-exchange-site.zip` on your computer.
2. On github.com choose **New repository**. Name it `grenada-farm-exchange`. Choose **Private**. Create it.
3. On the new repository's page choose **uploading an existing file**.
4. Open the unzipped folder, select **everything inside it** (not the folder itself), and drag it onto the GitHub page. `Dockerfile` and `render.yaml` must end up at the top level of the repository, not inside another folder. Hidden files such as `.env.example` should come along. If your computer hides them, drag the whole selection from the folder's inside.
5. Wait for the upload to finish, then choose **Commit changes**.

## Step 2. Create the app and database on Render

1. Sign in at render.com, using **Sign in with GitHub**, and allow it to see your new repository.
2. Choose **New**, then **Blueprint**. Pick the `grenada-farm-exchange` repository.
3. Render reads `render.yaml` and shows a web service and a database. It will ask you for five values:

   | Name | What to enter |
   |---|---|
   | `BASE_URL` | Your address with `https://` and no slash at the end, for example `https://yourdomain.com`. Use your own domain even though it isn't connected yet. |
   | `OPERATOR_NAME` | The name of the organisation that runs the site. This appears on the terms and privacy pages. |
   | `CONTACT_EMAIL` | An inbox someone reads. It appears on the site. |
   | `ADMIN_EMAIL` | The email you will sign in with as administrator. |
   | `ADMIN_INITIAL_PASSWORD` | A long password for that first administrator. |

4. Choose **Apply**. Render builds the app. The first build takes a few minutes.
5. When the service shows as live, open it from the Render dashboard. Add `/health` to the end of its address (it looks like `https://something.onrender.com/health`). You should see `ok`.

## Step 3. Sign in and remove the starting password

1. Go to your service's address on `onrender.com`, choose **Sign in**, and use `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD`.
2. In Render, open the service, then **Environment**, and **delete `ADMIN_INITIAL_PASSWORD`**. Save. The site restarts. You are now the only administrator and the password is no longer stored in the settings.
3. On the site's **Account** page you can change your password to a new one.

## Step 4. Connect your GoDaddy domain

1. In Render, open the service, then **Settings**, then **Custom Domains**, and add your domain. Add `www.yourdomain.com` too if you want both to work.
2. Render shows the DNS records you need. Keep that page open.
3. In GoDaddy, sign in, open **My Products**, find your domain, and open its **DNS** settings.
4. Add each record exactly as Render shows it (type, name and value). If GoDaddy already has a record with the same name and type, for example a "Parked" record for `@`, edit that one instead of adding a second. Do not change the domain's nameservers.
5. Go back to Render and choose to verify. It can take a few minutes, sometimes several hours, for the change to spread. Render sets up HTTPS automatically once the domain connects.
6. Open `https://yourdomain.com` and check for the padlock.

## Step 5. Test the full journey

1. Register a test farmer and a test hotel from the **Register** page, using other email addresses.
2. Sign in as administrator, open **Admin**, and approve both.
3. As the farmer, post surplus. As the hotel, post a matching need.
4. Check that the **Matches** page shows a match for each, and that **Admin, Messages sent** lists two messages. They will say "logged" until you connect Twilio and email.
5. Confirm on both sides, mark as delivered, then delete the test accounts from each one's Account page.

## Step 6. Before real people use it

- Connect Twilio and email (see the README, "Turn on text, WhatsApp and email"). Add the keys under **Environment** in Render.
- Get the terms and privacy pages reviewed by a lawyer.
- Work through `docs/LAUNCH-CHECKLIST.md`.
- In Render's database page, check that backups are on.

## If something goes wrong

- **The build fails.** Open the service's **Logs**, copy the last 30 lines, and send them to whoever is helping you.
- **The service starts and stops, or shows an error about the database.** Check the logs. The most common causes are a missing `DATABASE_URL` or the database still being created.
- **"Request blocked" when you submit a form.** Your `BASE_URL` doesn't match the address you are visiting. Fix it under **Environment**.
- **The domain shows a GoDaddy page.** The old GoDaddy record is still in use. Check the DNS records against what Render shows.
- **You can't sign in as administrator.** The first administrator is only created when none exists. If you already started the app once with the wrong password, ask a developer to run `bun scripts/create-admin.ts` from Render's Shell, or reset the database from the Render dashboard before you have any real data.
