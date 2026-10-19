// DRAFT legal pages. These are plain-language starting points, not legal advice.
// Have a Grenadian lawyer review and adapt them before launch, then bump TERMS_VERSION in config.ts.

import { html, type Raw } from "./util.ts";
import { env, TERMS_VERSION } from "./config.ts";

const draft = html`<div class="draft"><b>Draft for legal review.</b> This text has not been checked by a lawyer. Replace the items in [square brackets] and have it reviewed before you open the site to the public. Version ${TERMS_VERSION}.</div>`;

export function termsPage(): Raw {
  return html`<h1>Terms of use</h1>
${draft}
<div class="prose">
<p>These terms apply to the Grenada Farm Exchange website (the "Service"), run by ${env.operatorName} ("we", "us"). By creating an account you agree to them.</p>

<h2>What the Service does</h2>
<p>The Service lets farmers list produce they have to sell, and lets government agencies, hotels, restaurants and other buyers list what they want to buy. We compare the two and suggest matches. We do not buy, sell, store, transport or inspect any goods, and we are not a party to any sale.</p>

<h2>Accounts</h2>
<ul>
<li>You must give true information and keep it up to date. An administrator may ask you for proof, such as a farmer registration number or a business licence.</li>
<li>Every account is approved by an administrator before it can be used. We may refuse, suspend or close an account at our discretion, for example if information is false or the Service is misused.</li>
<li>Keep your password private. You are responsible for what is done with your account.</li>
</ul>

<h2>Listings and needs</h2>
<ul>
<li>Post only produce you really have, or needs you really intend to buy, and keep your posts current. Withdraw or close a post when it is no longer true.</li>
<li>Quantities, prices and dates are your own statements. We do not check them.</li>
<li>You must not post anything misleading, unlawful or abusive.</li>
<li>We may remove any post.</li>
</ul>

<h2>Matches and deals</h2>
<p>A match is only a suggestion. Quality, price, delivery, payment, import and export paperwork, plant health certificates and taxes are for the buyer and the seller to arrange between themselves. We give no guarantee that a match will lead to a sale, that goods will meet any standard, or that anyone will pay or deliver.</p>

<h2>Contact details</h2>
<p>When a match is suggested, the farmer and the buyer in that match can see each other's name, organisation and contact details. You may use them only to arrange that deal. You must not copy, sell or use them for unrelated marketing.</p>

<h2>Our responsibility</h2>
<p>The Service is provided as it is. To the fullest extent the law allows, we are not responsible for losses that come from a deal between users, from goods that are late, poor or never delivered, from unpaid invoices, or from the Service being unavailable. Nothing in these terms limits any right you have by law that cannot be limited. [Lawyer to confirm wording.]</p>

<h2>Changes</h2>
<p>We may change these terms. When the change is important we will ask you to accept the new version the next time you sign in.</p>

<h2>Law</h2>
<p>These terms are governed by the laws of [Grenada]. [Lawyer to confirm courts and dispute process.]</p>

<h2>Contact</h2>
<p>${env.operatorName} · ${env.contactEmail}</p>
</div>`;
}

export function privacyPage(): Raw {
  return html`<h1>Privacy</h1>
${draft}
<div class="prose">
<p>${env.operatorName} runs this site and is responsible for the personal information described here. We collect as little as we need to match farmers with buyers.</p>

<h2>What we collect</h2>
<ul>
<li><b>Account details:</b> name, email address, phone number, organisation or farm name, parish, the role you ask for, and the ID or licence note you give us to prove who you are.</li>
<li><b>What you post:</b> listings of produce and buying needs, including quantities, prices and dates.</li>
<li><b>Matches:</b> which listing was matched to which need, and whether each side confirmed, completed or cancelled.</li>
<li><b>Messages we send you:</b> a record of the text, WhatsApp and email notifications we send, and whether they were delivered.</li>
<li><b>Sign-in data:</b> a password stored only as a one-way hash, and a session cookie.</li>
<li><b>Consent:</b> the date you accepted these terms and which version.</li>
</ul>

<h2>Why we use it</h2>
<ul>
<li>To run your account, find matches and tell you about them.</li>
<li>To let administrators check accounts, remove misuse and keep the Service safe.</li>
<li>To produce totals about local supply and demand. Reports use totals and do not name individuals unless an administrator needs them to resolve a problem.</li>
</ul>

<h2>Who can see it</h2>
<ul>
<li><b>Other signed-in users</b> can see the product, quantity, price, parish and organisation name on posts. They cannot see your phone number or email address from a post.</li>
<li><b>The other side of a match</b> can see your name, organisation, phone number and email address, so you can arrange the deal.</li>
<li><b>Administrators</b> can see everything in the system.</li>
<li><b>Service providers</b> who process data for us: our hosting and database provider, our text and WhatsApp provider, and our email provider. [List the actual providers and where they store data.]</li>
<li>We do not sell your information. We share it with the authorities only where the law requires it.</li>
</ul>

<h2>Cookies</h2>
<p>We use one essential cookie to keep you signed in and a short-lived cookie to show a confirmation message. We do not use advertising or tracking cookies.</p>

<h2>How long we keep it</h2>
<p>We keep your account while it is open. When you delete your account we remove your name, email address, phone number and other personal details. Posts and matches stay in our records without your name, because they show how much produce was traded. [Confirm any legal record-keeping period, for example for completed deals.]</p>

<h2>Your choices and rights</h2>
<ul>
<li>You can change your contact details and how we notify you on the Account page.</li>
<li>You can download a copy of your information and delete your account from the Account page.</li>
<li>To ask anything else, or to complain, write to ${env.contactEmail}. You may also have the right to complain to the data protection authority in Grenada. [Lawyer to confirm which law and authority apply.]</li>
</ul>

<h2>Security</h2>
<p>Passwords are stored as hashes, connections use HTTPS, and administrator actions are logged. No system is perfectly secure. If we learn of a breach that affects you we will tell you as the law requires.</p>

<h2>Children</h2>
<p>The Service is for adults and registered businesses. It is not meant for anyone under 18.</p>

<h2>Changes</h2>
<p>If we change this notice in a way that matters, we will tell you and update the version number.</p>
</div>`;
}
