fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health/ready`, { signal: AbortSignal.timeout(4000) })
  .then((response) => { process.exitCode = response.ok ? 0 : 1; })
  .catch(() => { process.exitCode = 1; });
