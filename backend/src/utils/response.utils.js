/**
 * Consistent API response helpers.
 * Every response follows: { success, message, data }
 */

function success(message, data = null) {
  return { success: true, message, data };
}

function error(message, data = null) {
  return { success: false, message, data };
}

/**
 * Pagination helper.
 * Returns { data, meta: { total, page, perPage, totalPages } }
 */
function paginate({ data, total, page, perPage }) {
  return {
    data,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  };
}

/**
 * Parse pagination query params with sensible defaults.
 * Usage: const { page, perPage, skip } = parsePagination(req.query);
 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(query.perPage, 10) || 20));
  const skip = (page - 1) * perPage;
  return { page, perPage, skip };
}

module.exports = { success, error, paginate, parsePagination };
