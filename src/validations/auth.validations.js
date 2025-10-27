const Joi = require('joi');

const changePassword = {
  body: Joi.object().keys({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .min(8)
      .required()
      .pattern(new RegExp('^(?=.*[0-9])(?=.*[!@#$%^&*])'))
      .messages({
        'string.pattern.base': 'Password must contain at least one number and one special character',
        'string.min': 'Password must be at least 8 characters long',
        'any.required': 'New password is required'
      }),
    confirmNewPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'New password and confirm password do not match'
      })
  })
};

module.exports = {
  changePassword
};
