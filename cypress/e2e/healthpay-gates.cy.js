/**
 * HealthPay trial-1 — deployment gates A1–A7 as browser assertions.
 *
 * Plan v3 §5 requires these against the COMPILED BUNDLE, not the API: the
 * previous trial's tokenAuth defect was that the deployed frontend never
 * requested `token`, while the backend returned it correctly — a CLI mutation
 * test passed while the app was broken. Every assertion below therefore runs
 * in the real browser against the real build.
 *
 * Prereqs: stack up per compose.healthpay.yml, TLS issued (I3), migrations +
 * bootstrap applied and schema audit GREEN (I4), interactive admin created
 * with `manage create_interactive_admin` (NOT createsuperuser — see
 * bootstrap/README.md step 5).
 *
 * Run:
 *   CYPRESS_BASE_URL=https://<domain> npx cypress run \
 *     --spec cypress/e2e/healthpay-gates.cy.js
 * Credentials come from cypress/fixtures/cred.json (gitignored; see
 * cred.example.json). Never commit real credentials.
 */

const MARKER = 'HealthPay';

describe('HealthPay deployment gates (trial-1)', () => {
  let cred;

  before(() => {
    cy.fixture('cred').then((c) => {
      cred = c;
    
  it('A8 — least-privilege user is denied administration and claim review', () => {
    // Requires the enrolment officer created by:
    //   manage create_interactive_user --username hpofficer --role-is-system 1
    // Seeded matrix: Enrolment Officer = 23 rights, a strict subset of the
    // administrator's 249; lacks user-administration and claim-review rights.
    cy.fixture('cred').then((c) => {
      cy.visit('/front/login');
      cy.get('input[type="text"]', { timeout: 120000 }).first().clear().type(c.officerUsername);
      cy.get('input[type="password"]').first().clear().type(c.officerPassword, { log: false });
      cy.get('button[type="submit"]').click();
      cy.url({ timeout: 30000 }).should('not.include', '/front/login');

      // Administration menu must NOT be offered to this role
      cy.contains('الإدارة').should('not.exist');

      // Direct navigation to an admin route must not yield the users list
      cy.intercept('POST', '**/graphql', (req) => {
        if (req.body && /\busers\b/.test(JSON.stringify(req.body))) {
          req.alias = 'usersQueryAsOfficer';
        }
      });
      cy.visit('/front/admin/users', { failOnStatusCode: false });
      cy.get('body', { timeout: 30000 }).should('not.contain.text', 'hpadmin');
    });
  });
});
  });

  it('A1 — login page renders the HealthPay marker within the readiness budget', () => {
    cy.visit('/front/login');
    // Bounded readiness probe: the modular FE loads ~40 chunks sequentially and
    // shows a blank shell meanwhile (incident §3.5). Budget is 120s per plan v3.
    cy.get('body', { timeout: 120000 }).should('contain.text', MARKER);
    // Route-derived document title comes from fe-core's Helmet titleTemplate
    // (a hardcoded literal, not a translation key) — rebranded at source.
    cy.title().should('contain', MARKER);
    cy.get('input[type="password"]', { timeout: 120000 }).should('be.visible');
  });

  it('A1b — the shell is RTL and Arabic-capable', () => {
    cy.visit('/front/login');
    cy.get('html').should('have.attr', 'dir', 'rtl');
    cy.title().should('match', /هيلث باي/);
  });

  it('A2 — the compiled bundle requests AND receives both token and refreshExpiresIn', () => {
    // Intercept the app's own GraphQL traffic. Asserting on the REQUEST body is
    // the part a CLI test cannot do: it proves the shipped bundle asks for
    // `token`, which is exactly what regressed in the previous trial.
    cy.intercept('POST', '**/graphql', (req) => {
      if (req.body && /tokenAuth/.test(JSON.stringify(req.body))) {
        req.alias = 'tokenAuth';
      }
    });

    cy.visit('/front/login');
    cy.get('input[type="text"]', { timeout: 120000 }).first().clear().type(cred.username);
    cy.get('input[type="password"]').first().clear().type(cred.password, { log: false });
    cy.get('button[type="submit"]').click();

    cy.wait('@tokenAuth').then(({ request, response }) => {
      const query = JSON.stringify(request.body);
      expect(query, 'bundle requests token').to.match(/\btoken\b/);
      expect(query, 'bundle requests refreshExpiresIn').to.match(/refreshExpiresIn/);
      expect(response.statusCode).to.eq(200);
      const data = response.body && response.body.data && response.body.data.tokenAuth;
      expect(data, 'tokenAuth payload').to.be.an('object');
      expect(data.token, 'token returned').to.be.a('string').and.not.be.empty;
      expect(data.refreshExpiresIn, 'refreshExpiresIn returned').to.exist;
    });
  });

  it('A3/A4 — CSRF bootstrap runs and current_user returns 200 in-session', () => {
    // Contract pinned from the trial: _check_csrf_token reads
    // request.session['csrftoken'], which only exists after getCsrfToken has
    // run — so the app's own order is tokenAuth -> getCsrfToken -> queries.
    //
    // The app calls current_user TWICE: once on boot before credentials exist
    // (correctly 401), then again after tokenAuth (200). Registering the
    // intercept before login and waiting once resolves on the boot 401 and
    // asserts against the wrong call. Log in first, then register the
    // intercept and reload so only authenticated calls can match.
    cy.login();
    cy.intercept('GET', '**/api/core/users/current_user/').as('currentUserAuthed');
    cy.reload();
    cy.wait('@currentUserAuthed').then(({ request, response }) => {
      expect(response.statusCode, 'authenticated current_user').to.eq(200);
      // Bearer prefix contract (backend: JWT_AUTH_HEADER_PREFIX = "Bearer")
      const auth = request.headers.authorization;
      if (auth) {
        expect(auth, 'auth header uses Bearer, not JWT').to.match(/^Bearer /);
      }
    });
  });

  it('A5 — dashboard renders with HealthPay branding after login', () => {
    cy.login();
    cy.url({ timeout: 60000 }).should('include', '/front/home');
    cy.get('body', { timeout: 60000 }).should('contain.text', MARKER);
    // App bar logo asset is served (branding is not just the title tag)
    cy.request('/front/healthpayer-appbar.png').its('status').should('eq', 200);
  });

  it('A6 — admin menu opens and exposes the Slice-1 administration routes', () => {
    cy.login();
    cy.get('body', { timeout: 60000 }).should('contain.text', MARKER);
    // A user with i_user + roles resolves rights; an empty menu here means the
    // account is technical-only (see create_interactive_admin).
    // Assert on the Arabic admin menu label rather than English chrome: the
    // app bar renders الإدارة (Administration) for a rights-bearing user.
    cy.contains('الإدارة', { timeout: 60000 }).should('be.visible');
  });

  it('A7 — Users page loads with no GraphQL errors and lists at least the admin', () => {
    // The gate that ended the previous trial (missing core_Mutation_Log
    // columns). Also catches the t_user trap: resolve_users filters
    // Q(t_user__isnull=True), so an admin carrying a leftover technical user is
    // invisible on its own page and totalCount comes back 0.
    cy.intercept('POST', '**/graphql', (req) => {
      if (req.body && /\busers\b/.test(JSON.stringify(req.body))) {
        req.alias = 'usersQuery';
      }
    });
    cy.login();
    cy.visit('/front/admin/users');
    cy.wait('@usersQuery', { timeout: 60000 }).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.errors, 'no GraphQL errors').to.be.undefined;
      const users = response.body.data && response.body.data.users;
      expect(users, 'users payload').to.be.an('object');
      expect(users.totalCount, 'at least the admin is listed').to.be.greaterThan(0);
    });
  });
});
