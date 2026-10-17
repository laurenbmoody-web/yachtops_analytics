// The beta tester terms shown (and recorded) before a TestFlight build can be
// used. Bump BETA_TERMS_VERSION when the text changes: everyone is asked to
// accept the new version on their next launch. The same text, for the
// solicitor's review, is in docs/beta-tester-terms.md.

export const BETA_TERMS_VERSION = '2026-10-17';

export const BETA_TERMS_TITLE = 'Cargo beta tester terms';

export const BETA_TERMS_INTRO =
  'You are using a pre-release (beta) version of Cargo, provided by Cargo Technology Ltd, a company registered '
  + 'in England and Wales with company number 17525300 ("we", "us"). '
  + 'Please read these terms. By tapping "I agree" you accept them for as long as you use the beta.';

export const BETA_TERMS_SECTIONS = [
  {
    h: 'Confidentiality',
    p: [
      'The beta, its features, design, screens, workflows and any information we share about it are confidential.',
      'You must not show, describe, share, publish or post the beta or any part of it — including screenshots, screen recordings or photos of the screen — to anyone outside your own vessel’s Cargo workspace, without our written permission.',
      'This obligation continues after the beta ends or your access is removed, until we make the information public ourselves.',
    ],
  },
  {
    h: 'No copying',
    p: [
      'All rights in Cargo, including its software, design, look and feel, content and names, belong to us.',
      'You must not copy, reproduce, adapt, reverse engineer, decompile or attempt to extract the source code of Cargo, and you must not use Cargo or anything you learn from the beta to build, design, specify or help anyone else create a competing product or service.',
    ],
  },
  {
    h: 'Your account is for you only',
    p: [
      'Your login is personal. Do not share your email and password, let anyone else use your account, or sign in for someone else.',
      'We may limit how many devices can be signed in to one account at a time and sign out older devices.',
    ],
  },
  {
    h: 'Monitoring',
    p: [
      'To protect the beta, the app records sign-ins (time, device and approximate location from your IP address) and when a screenshot or screen recording is taken in the app. Your vessel’s Command team and Cargo Technology Ltd can see this activity.',
    ],
  },
  {
    h: 'Feedback',
    p: [
      'Ideas, suggestions and feedback you give us about Cargo can be used by us freely, without payment or attribution, and become part of Cargo.',
    ],
  },
  {
    h: 'Beta software and your vessel’s data',
    p: [
      'The beta may contain errors. It works on your vessel’s real Cargo data, so report anything that looks wrong. The beta is provided “as is”, and to the extent the law allows we are not liable for losses arising from its use.',
      'Your vessel’s data remains your vessel’s; these terms do not change how it is owned or handled under the Cargo Terms of Service and Privacy Policy.',
    ],
  },
  {
    h: 'Ending access',
    p: [
      'We may suspend or end your access to the beta at any time, including if we believe these terms have been broken. If you break these terms we may take legal action, including to stop further disclosure or copying.',
    ],
  },
  {
    h: 'Law',
    p: [
      'These terms are governed by the laws of England and Wales, and the courts of England and Wales have jurisdiction.',
    ],
  },
];
