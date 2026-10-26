/**
 * One /api/auth/me result per page load.
 * Callers share the in-flight promise. refresh() starts a new request
 * for the session timer and the "stay logged in" action.
 */

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
