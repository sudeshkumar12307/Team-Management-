# Cyber Cafe Manager

Free web app (works on phone and PC) for managing a cyber cafe team. Built with plain HTML/JS + Firebase (Auth, Firestore, Hosting) and GitHub Actions. No build step, no paid services (Firebase Spark plan is enough).

This is private service-centre software. It is not a government app and not a CSC. Applications are submitted through the official portals.

## Roles
| Role | Registration | What they do |
|---|---|---|
| Admin | created by you (step 5) | sets Distributor / Super Distributor fees and the fee-collection UPI ID, approves fee payments, suspends users |
| Super Distributor | pays fee set by admin | referral link, sees people they onboarded |
| Distributor | pays fee set by admin | referral link, sees people they onboarded |
| Retailer (cafe owner) | FREE, instant | services on/off, own UPI ID + QR, orders, operators, incentives, cash book |
| Operator | created by the retailer | orders, attendance, sees own level and extra income |

Customers need no login. Each retailer has a public page (`/#/shop/<id>`) showing available services and a UPI pay QR.

## Retailer features
- Service list with price and an Available / Off switch (one tap adds 17 common cyber cafe services)
- Own UPI ID: payment QR / UPI link for each order, money goes directly to the owner's bank account; mark order Paid (UPI or Cash)
- Orders / applications: reference number, customer, service, amount, status (received, processing, submitted, completed, rejected), payment status, notes
- Team: add operator logins, deactivate, daily attendance, monthly performance
- Extra income: commission % on paid work plus a monthly target bonus. Four levels (Trainee, Operator, Senior, Lead). When an operator's lifetime completed orders reach the next level, a Promote button appears; higher levels earn extra commission %. All numbers are set in Shop settings.
- Cash book: income, expenses, operator extra income, net profit, service-wise income by month

## Setup (about 15 minutes)
1. Go to https://console.firebase.google.com, create a project (Spark / free plan).
2. Build > Authentication > Get started > enable **Email/Password**.
3. Build > Firestore Database > Create database (production mode).
4. Project settings > Your apps > add a **Web app**, copy the config into `public/js/firebase-config.js`.
5. Firestore > Rules: paste the contents of `firestore.rules` and Publish.
6. Edit `.firebaserc` and put your project ID.
7. Create the first admin: open the site, Register as Retailer, then in Firestore open `users/<your uid>` and change `role` to `admin` (and delete nothing else). Log out and in again. Open Settings and set the fees and your UPI ID.

## Deploy
Option A (quickest): `npm i -g firebase-tools`, `firebase login`, `firebase deploy`.

Option B (GitHub): push this folder to a GitHub repo. In the repo's Settings > Secrets add `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT` (service account JSON from Firebase project settings). Every push to `main` deploys automatically (`.github/workflows/deploy.yml`).

## Notes
- UPI payments are paid directly by the customer to the UPI ID in the app. The app does not see the bank, so confirm the money before tapping Paid. Distributor fees work the same way: they pay your UPI and enter the UTR, you approve.
- Operators cannot be deleted from the browser (a Firebase limit); use Deactivate.
- Firestore security rules enforce who can see what. Do not skip step 5.
