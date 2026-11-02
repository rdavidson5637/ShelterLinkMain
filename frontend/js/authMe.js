/**
 * One /api/auth/me result per page load.
 * Callers share the in-flight promise. refresh() starts a new request
 * for the session timer and the "stay logged in" action.
 */

/**
 * signed-in: a user came back.
 * signed-out: 401, 403, or any other answer that is not a rate limit or a 5xx.
 * A 403 is how an unlocked kiosk answers, so it must not look like a lost signal.
 * unreachable: the request never got a normal answer, or the server was too busy or down.
 */
export function authMeOutcome(result) {
  if (!result || result.networkError) return 'unreachable';
  if (result.ok && result.user) return 'signed-in';
  const status = Number(result.status) || 0;
  if (status === 429 || status >= 500) return 'unreachable';
  return 'signed-out';
}

export function createAuthMeLoader(request) {
  let current = null;

  function start() {
    const promise = Promise.resolve()
      .then(() => request())
      .then(async (res) => {
        let user = null;
        if (res && res.ok && typeof res.json === 'function') {
          try {
            user = await res.json();
          } catch {
            user = null;
          }
        }
        return {
          ok: Boolean(res && res.ok),
          status: res && typeof res.status === 'number' ? res.status : 0,
          user: user || null,
          networkError: false,
        };
      })
      .catch(() => ({
        ok: false,
        status: 0,
        user: null,
        networkError: true,
      }));
    current = promise;
    return promise;
  }

  return {
    load() {
      if (current) return current;
      return start();
    },
    refresh() {
      return start();
    },
  };
}
