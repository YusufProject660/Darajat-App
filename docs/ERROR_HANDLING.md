# Error Handling Guide

This document outlines the standardized error handling approach used in the Darajat Backend.

## Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error message for client",
  "error": "Error details (development only)",
  "stack": "Error stack trace (development only)",
  "details": "Additional error details (if any)"
}
```

## Error Types

### AppError Class

The `AppError` class is the base class for all operational errors in the application.

```typescript
class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: any;
}
```

### Common Error Types

Use these helper functions to create consistent errors:

```typescript
// 400 Bad Request
createError.badRequest('Invalid input', { field: 'email' });

// 401 Unauthorized
createError.unauthorized('Invalid credentials');

// 403 Forbidden
createError.forbidden('Insufficient permissions');

// 404 Not Found
createError.notFound('User not found');

// 409 Conflict
createError.conflict('Email already in use');

// 500 Internal Server Error
createError.internal('Database connection failed');
```

## Handling Errors in Controllers

### Synchronous Code

```typescript
export const getUser = (req, res, next) => {
  const user = User.findById(req.params.id);
  
  if (!user) {
    throw createError.notFound('User not found');
  }
  
  res.json({ success: true, data: user });
};
```

### Asynchronous Code

```typescript
export const updateUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!user) {
      throw createError.notFound('User not found');
    }
    
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};
```

## Built-in Error Handling

The following error types are automatically handled:

- `CastError` (MongoDB invalid ID)
- `ValidationError` (Mongoose validation)
- `JsonWebTokenError` (Invalid JWT)
- `TokenExpiredError` (Expired JWT)
- Duplicate key errors (MongoDB)
- Custom `AppError` instances

## Development vs Production

In development mode, error responses include:
- Error stack traces
- Detailed error messages
- Additional error details

In production, only the error message is returned for operational errors. For all other errors, a generic "Something went wrong" message is returned.

## Best Practices

1. Always use `AppError` for expected, operational errors
2. Use the appropriate HTTP status code
3. Provide helpful, user-friendly error messages
4. Include additional details in the `details` field when needed
5. Let unexpected errors bubble up to the global error handler
6. Use try/catch for async/await code or use `express-async-errors`

## Testing

When writing tests, you can check for specific error types and properties:

```typescript
it('should return 404 for non-existent user', async () => {
  const res = await request(app).get('/api/users/nonexistent');
  expect(res.status).toBe(404);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toContain('not found');
});
```
