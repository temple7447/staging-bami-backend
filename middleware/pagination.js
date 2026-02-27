const pagination = (defaultLimit = 20, maxLimit = 100) => {
  return (req, res, next) => {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || defaultLimit;

    if (page < 1) page = 1;
    if (limit < 1) limit = defaultLimit;
    if (limit > maxLimit) limit = maxLimit;

    const skip = (page - 1) * limit;

    req.pagination = {
      page,
      limit,
      skip,
      maxLimit
    };

    res.paginate = (data, total) => {
      const totalPages = Math.ceil(total / limit);
      return {
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        }
      };
    };

    next();
  };
};

module.exports = pagination;
