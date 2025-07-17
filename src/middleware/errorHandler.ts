import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', error);

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: error.details
    });
  }

  if (error.code === 'P2002') {
    return res.status(409).json({
      error: 'Duplicate entry',
      field: error.meta?.target
    });
  }

  if (error.code === 'P2025') {
    return res.status(404).json({
      error: 'Record not found'
    });
  }

  res.status(error.status || 500).json({
    error: error.message || 'Internal server error'
  });
};