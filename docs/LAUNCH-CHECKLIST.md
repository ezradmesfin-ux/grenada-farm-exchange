# Launch checklist

The code covers the software side. Most of what decides whether this works is below, and none of it can be done by code.

## Before anyone outside your team uses it

**Legal and data**
- [ ] A Grenadian lawyer reviews and edits the terms (`src/legal.ts`). Replace every item in [square brackets].
- [ ] Confirm which data protection law applies, whether you must register as a data controller, how long records must be kept, and which authority people can complain to.
- [ ] Set `OPERATOR_NAME` and `CONTACT_EMAIL` to a real organisation and an inbox someone reads.
- [ ] Decide who is allowed to see farmers' contact details inside the government, and write it down. Administrators can see everything.

**People and process**
- [ ] Agree who approves accounts, how they check proof (farmer registration, business licence, staff ID), and how fast they reply. A slow approval queue kills a new site.
- [ ] Have at least two administrators.
- [ ] Decide what happens when a buyer does not pay or a farmer does not deliver. The site only introduces people. Write a simple rule for warnings, suspension and disputes.
- [ ] Set up a support phone number or WhatsApp line. Many farmers will need help with the first post.

**Technical**
- [ ] Managed Postgres with automatic backups. Restore one backup into a test database to prove it works.
- [ ] HTTPS on your own domain. `NODE_ENV=production` and `BASE_URL` set.
- [ ] Twilio and Resend set up, and a real test match received on a Grenadian phone. Confirm text and WhatsApp delivery, and register WhatsApp message templates if you use WhatsApp.
- [ ] A budget for message costs. Estimate: matches per week times two people.
- [ ] Uptime alert on `/health`.
- [ ] Open every page on a cheap Android phone and an iPhone, on a slow connection, in light and dark mode.
- [ ] A security review of the deployed site by someone independent, before it holds real people's details.

## Pilot, not big bang

1. Pick one parish and two or three crops.
2. Sign up 10 to 20 farmers and 3 to 5 buyers by hand, with someone helping each of them.
3. Run it for 4 to 6 weeks. Count real completed deliveries, not sign-ups.
4. Ask: did the matches make sense, did people answer messages, what did they do outside the site?
5. Only then widen to more parishes and crops, and think about export and import steps.

## Things to build next, if the pilot works

- Phone-number verification at sign-up, and sign-in links by text for people who forget passwords.
- Creole and simple-language versions of the key pages.
- Delivery windows, quality grades and pack sizes in listings and needs.
- Rating or reliability record for buyers and farmers.
- Cross-border support: certificates, shipping contacts, partner buyers in other countries.
- A government report page with trends by crop and parish.
