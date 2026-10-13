// Static pages: How it works, Terms of Use, Privacy Policy, Content & Safety Policy.
import { ic, esc, LABEL, badge, config } from './util.js';

const UPDATED = '13 October 2026';
const CC = '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
const site = () => esc(config.name || 'Records of Event');
const op = () => esc(config.operator || 'the people who run this site');
const mail = () => (config.contact ? `<a href="mailto:${esc(config.contact)}">${esc(config.contact)}</a>` : 'the contact address on this page');
const pre = () => config.moderation !== 'post';
const labels = () => `<ul class="doc-labels">${Object.keys(LABEL).map((k) => `<li>${badge(k)}<span>${esc(LABEL[k][2])}.</span></li>`).join('')}</ul>`;

export function renderPage(root, name) {
  const page = PAGES[name];
  if (!page) return false;
  root.innerHTML = page();
  return true;
}

/* ---------- How it works ---------- */
function how() {
  const flow = [
    ['phone', '#ff3d7f', 'Your phone', 'Location removed'],
    ['hash', '#7c5cff', 'Fingerprint', 'SHA-256 on your device'],
    ['archive', '#22c3e6', 'Stored', 'Original file kept unchanged'],
    ['face', '#ffb020', 'Safety check', 'A person reviews it'],
    ['globe', '#12b886', 'Public', 'Anyone can watch, download and verify'],
  ];
  const faq = [
    ['Who runs this?', `<p>${config.operator ? `${site()} is run by ${op()}. ` : ''}The code is open source${config.repo ? ` (<a href="${esc(config.repo)}" target="_blank" rel="noopener">source code</a>)` : ''}, so anyone can check how it works. No accounts, no ads, no trackers.</p>`],
    ['What gets removed, and why?', `<p><b>From your file:</b> location and phone details are removed from MP4 and MOV files on your device, before upload, so the video can't point back to you. Other formats can't be checked, and you are warned before uploading them.</p><p><b>From the archive:</b> videos that break the <a href="/policy">Content &amp; Safety Policy</a>. A removed record keeps a public note with the reason, so nothing disappears silently.</p>`],
    ['What do the labels mean?', labels()],
    ['How do I remove my own upload?', '<p>After uploading you get a private receipt link. Open it to remove any of your videos, at any time. There are no accounts, so keep the link safe: anyone who has it can remove your videos, and it can\'t be resent.</p>'],
    ['How do I check a file is genuine?', '<p>Open <a href="/verify">Verify</a> and choose the file. Your browser works out its SHA-256 fingerprint (the video is not uploaded) and looks it up. A match tells you exactly which record it is. Change one byte and it no longer matches.</p>'],
    ['Can I reuse the videos?', `<p>Yes. Published videos are licensed ${CC}: share, broadcast or adapt them, even commercially, as long as you credit ${site()} and link to the record.</p>`],
  ];
  return `<div class="wrap doc-how">
    <h1 class="doc-hero">Footage that can't be quietly deleted.</h1>
    <p class="doc-sub">Upload raw video from a protest or any public event. It is fingerprinted on your phone, kept exactly as filmed, checked by a person, then open to everyone.</p>
    <div class="doc-flow">${flow.map(([i, c, t, s], k) => `<div class="card doc-step" style="--c:${c}"><span class="doc-ico">${ic(i, 24)}</span><span class="mono doc-n">0${k + 1}</span><h3>${t}</h3><p>${s}</p></div>`).join('')}</div>
    <div class="doc-ctas"><a class="btn btn-accent btn-lg" href="/upload">${ic('upload', 18)}Upload footage</a><a class="btn btn-ghost btn-lg" href="/verify">${ic('shield', 18)}Verify a file</a></div>
    <section class="section doc-faq">
      <div class="section-head"><h2>Questions</h2></div>
      ${faq.map(([q, a]) => `<details><summary>${q}${ic('plus', 18)}</summary><div>${a}</div></details>`).join('')}
    </section>
  </div>`;
}

/* ---------- legal pages ---------- */
const DOCS = [['terms', 'Terms of Use'], ['privacy', 'Privacy Policy'], ['policy', 'Content & Safety Policy']];
function legal(key, intro, sections) {
  const title = DOCS.find((d) => d[0] === key)[1];
  return `<div class="wrap doc">
    <header class="doc-head"><h1>${esc(title)}</h1><p class="doc-upd">${ic('calendar', 15)}Last updated ${UPDATED}</p><p class="doc-intro">${intro}</p></header>
    <nav class="doc-toc" aria-label="On this page"><b>On this page</b><ol>${sections.map(([id, h]) => `<li><a href="#${id}">${h}</a></li>`).join('')}</ol></nav>
    <div class="doc-body">${sections.map(([id, h, body]) => `<section id="${id}"><h2>${h}</h2>${body}</section>`).join('')}</div>
    <nav class="doc-more" aria-label="Other policies">${DOCS.filter((d) => d[0] !== key).map(([k, t]) => `<a href="/${k}">${esc(t)}${ic('arrow', 16)}</a>`).join('')}<a href="/how">How it works${ic('arrow', 16)}</a></nav>
  </div>`;
}

function terms() {
  return legal('terms', `${site()} is a free, public archive of raw footage from protests and other public events. “We” and “us” mean ${op()}. By using the site or uploading to it, you agree to these terms.`, [
    ['use', 'Using the archive', `<p>Anyone can watch, download and verify what is published here, without an account. Please don't:</p><ul><li>use footage to harass, threaten or expose people who appear in it;</li><li>overload, attack or try to get around the site's limits;</li><li>claim to speak for us, or misrepresent our labels.</li></ul>`],
    ['upload', 'Uploading', `<p>When you upload, you confirm that:</p><ul><li>you filmed the video, or have the right to share it;</li><li>it is real footage of the event you chose, not edited to mislead;</li><li>it follows the <a href="/policy">Content &amp; Safety Policy</a>.</li></ul><p>${pre() ? 'A moderator reviews every upload before it goes public' : 'Uploads go public straight away and a moderator then reviews them'}, and may decline, label or remove any video. You are responsible for what you upload.</p>`],
    ['licence', 'Licence', `<p>Published videos are available under ${CC}. By uploading, you grant this licence once your video is published. Anyone may then copy, share and adapt it, including commercially, if they credit ${site()} and link to the record.</p><p>The licence can't be withdrawn for copies people already have, even if you later remove the video here. It covers copyright in the footage only, not the rights of people who appear in it.</p>`],
    ['receipt', 'Your receipt link', '<p>There are no accounts. After uploading you get a private receipt link that shows the status of your videos and lets you remove them at any time. Anyone with the link can remove your videos. We store only a scrambled form of it, so we can\'t recover or resend it.</p>'],
    ['accuracy', 'Labels and accuracy', '<p>Videos are shown as uploaded. Labels describe what moderators were able to check; they are not a guarantee. Filming times and places come from the file or the uploader and can be wrong. Use your own judgement, and report mistakes.</p>'],
    ['removal', 'Moderation and removal', '<p>We may hide, relabel or delete any video or event, for example under the <a href="/policy">Content &amp; Safety Policy</a> or after a valid legal request. When a video is removed, its record stays online with a public note giving the reason.</p>'],
    ['warranty', 'No warranty', '<p>The site is free and provided “as is”. We work to keep it running and files safe, but can\'t promise it will always be available or that nothing will ever be lost. As far as the law allows, we are not liable for losses from using the site or its footage.</p>'],
    ['changes', 'Changes and contact', `<p>We may update these terms; the date at the top shows the current version. Questions: ${mail()}.</p>`],
  ]);
}

function privacy() {
  return legal('privacy', `This policy explains what ${site()} collects and why. “We” means ${op()}. We collect as little as possible.`, [
    ['short', 'The short version', `<ul class="doc-checks"><li>No accounts, no ads, no third-party trackers or analytics.</li><li>Fonts are served from this site, not a font service.</li><li>Your IP address is not stored.</li><li>Location and phone details are removed from MP4 and MOV files on your device before upload.</li><li>You can remove your uploads at any time with your receipt link.</li></ul>`],
    ['visit', 'When you visit', '<p>We don\'t set cookies for visitors or track what you watch. To stop abuse, your IP address is turned into a keyed hash that changes every day; the address itself is never stored. The hash is used for rate limits and to tell repeated reports apart. Rate-limit counters are deleted after about three days.</p><p>Your browser may remember small settings, such as light or dark mode, on your own device. Our hosting and storage providers may keep short technical logs under their own policies.</p>'],
    ['upload', 'When you upload', `<p>Before anything leaves your device, location and phone details are removed from MP4 and MOV files. Other formats can't be checked, and you are warned before uploading them. We then store:</p><ul><li>the video file and a still image from it;</li><li>filming time, length, resolution, size and file type;</li><li>the place and note you add, and whether it is marked sensitive;</li><li>SHA-256 fingerprints of the file before and after cleaning;</li><li>the original file name, shown only on your receipt;</li><li>the daily hash described above, for upload limits.</li></ul><p>We never ask for your name, email or phone number.</p>`],
    ['public', 'What becomes public', `<p>${pre() ? 'Once a moderator approves it' : 'Once published'}, the video, still image, filming time, length, resolution, size, place, note, label and fingerprints are public under ${CC}. The file name and the daily hash are never published.</p>`],
    ['reports', 'Reports', '<p>If you report a video, we keep the reason, your details and any contact you choose to give. Only moderators see the contact, and we use it only to reply about your report.</p>'],
    ['storage', 'Where data is kept', `<p>Videos and still images are kept in S3-compatible storage (for example Cloudflare R2). Everything else is in a Postgres database. These run on providers chosen by ${op()} and may be in a different country from you.</p>`],
    ['keep', 'How long we keep it', '<p>Published videos stay until they are removed, by you through your receipt link or by a moderator. Removing a video deletes the file. The record number, fingerprints and reason stay as a public note. Unfinished uploads are deleted after a day.</p>'],
    ['mods', 'Moderators', '<p>A moderator reviews uploads. Moderators sign in with a password, which sets one sign-in cookie on their device. Each moderation action is logged with the name they gave.</p>'],
    ['choices', 'Your choices and contact', `<p>Remove your own uploads at any time with your receipt link. For anything else, such as a video that shows you, use Report on the video's page or write to ${mail()} with the record number. If this policy changes, we update the date at the top.</p>`],
  ]);
}

function policy() {
  return legal('policy', `${site()} keeps raw, first-hand footage of public events so it can't be quietly lost or deleted. This policy explains what belongs here and how removal works.`, [
    ['allowed', 'What belongs here', '<ul><li>Video you filmed at a protest, march, rally, strike, vigil, election, disaster, accident, public meeting or similar event.</li><li>Footage as it came from the camera: no added music, captions, filters or commentary.</li><li>Police, officials and public figures acting in public.</li></ul>'],
    ['not-allowed', 'What is not allowed', '<ul><li>Sexual content, and anything that sexualises children.</li><li>Filming in private places such as homes, toilets or medical rooms without consent.</li><li>Videos posted to target, threaten or expose a private person, or that show private details such as home addresses or ID documents.</li><li>Calls to violence.</li><li>Fake, staged or manipulated footage, or footage from a different event.</li><li>Material you have no right to share, such as TV broadcasts or other people\'s videos.</li><li>Spam, advertising or anything unrelated to an event.</li></ul>'],
    ['sensitive', 'Sensitive footage', '<p>Events can be violent. Footage of injuries, blood, death or other distressing scenes is allowed when it documents what happened. Uploaders and moderators mark it <b>Sensitive</b>: it is blurred in previews, carries a warning, and is never used as an event\'s cover image.</p>'],
    ['people', 'People in the footage', '<p>Crowds, bystanders and officials appear in footage of public events, and that alone is not a reason to remove it. If a video puts someone at real risk, for example by clearly identifying an injured person, a child or a protester who could face reprisals, please report it. We weigh the value of the record against the risk to the person.</p>'],
    ['labels', 'Labels', labels()],
    ['review', 'How review works', `<p>${pre() ? 'A moderator looks at every upload before it becomes public.' : 'Uploads go public straight away; a moderator then reviews each one.'} They check it fits this policy, set a label, and mark it sensitive if needed. Rejected uploads are deleted, and the reason is shown on the record.</p>`],
    ['removal', 'Removal requests', '<p>Anyone can use <b>Report</b> on a video or event page, with no account. Choose a reason, add details and, if you want a reply, a way to reach you. You get a reference number (REQ-…). If several different people report the same video, it is hidden automatically until a moderator has looked.</p><p>If you uploaded the video, you don\'t need to ask: open your receipt link and remove it.</p>'],
    ['copyright', 'Copyright notices', `<p>If you own the copyright in a video here and did not agree to it being shared, report it with the reason “Copyright”, or write to ${mail()} with:</p><ul><li>the record number or link;</li><li>the work you own;</li><li>how to contact you;</li><li>a statement that this is accurate and that you own the rights or act for the owner.</li></ul><p>If the notice is valid we delete the file and the record says it was removed after a copyright notice. If you uploaded the video and think the notice is wrong, write to us with the record number.</p>`],
    ['authorities', 'Requests from authorities', '<p>We hold very little: no accounts, no IP addresses, no names or emails, except a contact someone chose to give in a report. We review any request from police, courts or governments carefully, ask for it in writing, and act only on requests that are valid and specific. Footage being unwelcome to someone in power is not, on its own, a reason to remove it. When a video is removed because of a request, its record says so.</p>'],
    ['transparency', 'Transparency', `<p>Nothing disappears silently. When a video is rejected, hidden or deleted, by a moderator, after reports or by the person who uploaded it, its record stays online as a tombstone with the reason. Every moderator action is recorded in a moderation log.</p><p>To appeal a decision, write to ${mail()} with the record number.</p>`],
  ]);
}

const PAGES = { how, terms, privacy, policy };
