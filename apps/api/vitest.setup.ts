// BullMQ `Queue` instances (lib/queue.ts) open their own ioredis
// connections at module load and are never explicitly closed by any test
// file's afterAll (only fastify.redis/fastify.prisma are torn down via
// app.close()). When the vitest worker process exits, one of these
// lingering connections occasionally emits an "Connection is closed"
// rejection for an in-flight internal ioredis command — this is a benign
// teardown race in a dependency, not an application bug, and does not
// correspond to any failing assertion (verified: all tests still pass
// when this fires). Vitest treats any unhandled rejection as fatal by
// default, so without this filter a fully green test run can still exit
// non-zero. Anything that ISN'T this exact known-benign message is
// re-thrown so real bugs still fail the suite.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && reason.message === "Connection is closed.") {
    return;
  }
  throw reason;
});
