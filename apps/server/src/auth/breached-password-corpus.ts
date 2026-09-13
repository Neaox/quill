/**
 * The local breached-password corpus (ADR-011: "a local fallback list when
 * that service is unreachable").
 *
 * The remote check is the real one — half a billion passwords, matched by
 * k-anonymity. This exists for the minutes or hours when that service cannot
 * be reached, because "the corpus is down" must not quietly become "there is
 * no corpus" (review finding M10): those are exactly the moments an operator
 * does not notice that every password chosen today went unchecked.
 *
 * **What it is.** A base list of the passwords that sit at the top of every
 * published breach corpus — SecLists' `10-million-password-list-top-*`
 * (MIT-licensed), the NCSC/Have I Been Pwned "top 100k" publication (public
 * domain), and the rockyou list they both descend from — written out here by
 * hand rather than vendored, so this file carries no third-party licence and
 * no build step. It is then expanded mechanically with the suffixes people
 * actually append when a length rule pushes them past twelve characters,
 * which is what makes a short top-N list relevant to a platform whose
 * minimum is twelve (`PASSWORD_MIN_LENGTH`): `password` is unusable here,
 * `password1234` is not, and it is in every breach corpus there is.
 *
 * **What it is not.** A substitute for the remote check. A few thousand
 * entries against five hundred million is a floor, not a ceiling, and the
 * `auth.breached_password.unavailable` audit event still fires whenever the
 * remote verdict is missing so that the gap is visible.
 */

/**
 * Passwords that appear at the top of every published corpus, lower-cased.
 *
 * Kept in families — keyboard walks, names, sports, profanity, the words
 * people reach for when told "make it memorable" — because that is how a
 * reader checks whether something obvious is missing.
 */
const BASE_PASSWORDS: readonly string[] = [
  // Numbers and keyboard walks
  'password',
  'passw0rd',
  'pa55word',
  'p@ssword',
  'p@ssw0rd',
  'passwort',
  'contrasena',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '123123',
  '112233',
  '121212',
  '654321',
  '11111',
  '111111',
  '1111111',
  '000000',
  '666666',
  '888888',
  '999999',
  '123321',
  'qwerty',
  'qwertyu',
  'qwertyui',
  'qwertyuiop',
  'qwerty123',
  'qazwsx',
  'qazwsxedc',
  '1qaz2wsx',
  'asdfgh',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  'azerty',
  'qwertz',
  '1q2w3e4r',
  '1q2w3e4r5t',
  'abc123',
  'abcd1234',
  'a1b2c3',
  'aaaaaa',
  'asdasd',
  'asdfasdf',
  'poiuyt',
  'lkjhgf',
  'mnbvcxz',
  // The words themselves
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'basketball',
  'superman',
  'batman',
  'spiderman',
  'pokemon',
  'starwars',
  'jordan',
  'harley',
  'ranger',
  'hunter',
  'buster',
  'thomas',
  'tigger',
  'robert',
  'soccer',
  'hockey',
  'killer',
  'george',
  'charlie',
  'andrew',
  'michelle',
  'jessica',
  'pepper',
  'daniel',
  'jennifer',
  'joshua',
  'maggie',
  'summer',
  'ashley',
  'nicole',
  'chelsea',
  'biteme',
  'matthew',
  'access',
  'yankees',
  'dallas',
  'austin',
  'thunder',
  'taylor',
  'matrix',
  'mustang',
  'shadow',
  'master',
  'michael',
  'freedom',
  'whatever',
  'trustno1',
  'ncc1701',
  'computer',
  'internet',
  'samsung',
  'liverpool',
  'arsenal',
  'chelseafc',
  'barcelona',
  'realmadrid',
  'manchester',
  'juventus',
  'cheese',
  'chocolate',
  'cookie',
  'flower',
  'butterfly',
  'purple',
  'orange',
  'iloveyou',
  'ilovegod',
  'jesus',
  'heaven',
  'angel',
  'family',
  'forever',
  'friends',
  'lovely',
  'hello',
  'secret',
  'shalom',
  'qwerty1',
  'love',
  'money',
  'rainbow',
  'diamond',
  'phoenix',
  'silver',
  'golden',
  'winter',
  'autumn',
  'spring',
  'january',
  'february',
  'december',
  'november',
  // Phrases and admin-shaped defaults
  'letmein123',
  'iloveyou1',
  'administrator',
  'admin',
  'administrador',
  'root',
  'toor',
  'changeme',
  'default',
  'guest',
  'test',
  'testing',
  'temporary',
  'welcome1',
  'welcome123',
  'passwordpassword',
  'adminadmin',
  'secretsecret',
  'letmeinnow',
  'opensesame',
  'correcthorsebatterystaple',
  'trustnoone',
  'iamawesome',
  'gettingbetter',
  'nopassword',
  'thisismypassword',
  'mypassword',
  'newpassword',
  'oldpassword',
  'setpassword',
  'notapassword',
  'qwertyuiopasdfghjkl',
  'abcdefghijkl',
  'abcdefghijklmnop',
  'thequickbrownfox',
  'keyboardwarrior',
  'supersecret',
  'letmeinplease',
  'helloworld',
  'helloworld1',
  // Swearing and the rest of the long tail's head
  'fuckyou',
  'fuckoff',
  'bullshit',
  'asshole',
  'bitch',
  'whocares',
  'nothing',
  'anything',
  'something',
  'whatever1',
  'blahblah',
  'blahblahblah',
  'nevermind',
  'idontknow',
  'dontknow',
] as const

/**
 * What people append when a minimum length pushes them past a word they
 * already had. `''` keeps the base word itself in the list.
 */
const SUFFIXES: readonly string[] = [
  '',
  '1',
  '12',
  '123',
  '1234',
  '12345',
  '123456',
  '!',
  '1!',
  '123!',
  '01',
  '007',
  '69',
  '99',
  '2020',
  '2021',
  '2022',
  '2023',
  '2024',
  '2025',
  '2026',
] as const

/** And what they put in front of it. */
const PREFIXES: readonly string[] = ['', 'my', 'the'] as const

let corpus: ReadonlySet<string> | null = null

/**
 * The corpus, built once.
 *
 * Built lazily and then cached, which is safe here in a way it would not be
 * for a password *hash*: this is a pure derivation of two constant arrays,
 * costs no measurable time, and holds no secret — the reason
 * `createPasswordHasher` insists on composition time does not apply.
 */
export function localBreachedPasswords(): ReadonlySet<string> {
  corpus ??= new Set(
    PREFIXES.flatMap((prefix) =>
      BASE_PASSWORDS.flatMap((base) => SUFFIXES.map((suffix) => `${prefix}${base}${suffix}`)),
    ),
  )
  return corpus
}

/**
 * Whether the local corpus knows this password.
 *
 * Case-insensitive, because `Password123` and `password123` are the same
 * guess to anybody running a list, and the corpus is stored lower-cased.
 */
export function isLocallyKnownBreached(password: string): boolean {
  return localBreachedPasswords().has(password.toLowerCase())
}
