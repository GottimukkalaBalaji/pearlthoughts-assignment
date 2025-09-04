import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error('Error:', error);

  // Default error response
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
};