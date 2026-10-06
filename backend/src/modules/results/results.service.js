async function getResults() {
    // TODO: Query aggregated votes with Prisma once the final schema is available.
    return { categories: [], updatedAt: new Date().toISOString() };
}

module.exports = { getResults };
