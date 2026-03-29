const errorHandler = (err, req, res, next) => {
    console.error("Global Error Handler Catch:", err.stack);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
};

module.exports = errorHandler;
