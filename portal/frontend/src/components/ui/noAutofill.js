// Spread onto text inputs that hold OTHER systems' data (addresses, phones, IPs,
// usernames…) so Chrome/Edge and password managers stop offering to save/autofill
// them. autoComplete="off" alone is widely ignored by Chrome's address/phone
// heuristics, so we also send an unrecognised token plus the manager-ignore hints.
// Chrome ignores autoComplete="off" for its address/payment SAVE prompt, but it
// honours an *unrecognised* token - so we send a nonsense value. Combined with the
// password-manager ignore hints this stops both autofill and the "save address?"
// bar. (Pair with autoComplete="off" on the <form> too.)
export const noAutofill = {
  autoComplete: 'off-app',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-form-type': 'other',
};
