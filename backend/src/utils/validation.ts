import { GraphQLError } from 'graphql';
import type { StudentInput } from '../services/userService';
import { currentLocalDate, isValidLocalDate } from './datetime';

const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;
const NOTES_MAX_LENGTH = 2000;
const ALLERGY_MAX_LENGTH = 100;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const PHONE_MIN_LENGTH = 7;
const PHONE_MAX_LENGTH = 20;
const EARLIEST_BIRTH_DATE = '1900-01-01';

export function badUserInput(message: string, field: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT', field } });
}

export function validateText(value: string, field: string, max: number): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw badUserInput(`${field} cannot be empty`, field);
  }

  if (trimmed.length > max) {
    throw badUserInput(`${field} must be at most ${max} characters`, field);
  }

  return trimmed;
}

export function validateOptionalText(
  value: string | null | undefined,
  field: string,
  max: number
): string | null {
  if (value == null || value.trim().length === 0) {
    return null;
  }

  return validateText(value, field, max);
}

export function validateEmail(value: string, field = 'email'): string {
  const email = validateText(value, field, EMAIL_MAX_LENGTH).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badUserInput(`${field} must be a valid email address`, field);
  }

  return email;
}

export function validatePassword(value: string, field = 'password'): string {
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw badUserInput(`${field} must be at least ${PASSWORD_MIN_LENGTH} characters`, field);
  }

  if (value.length > PASSWORD_MAX_LENGTH) {
    throw badUserInput(`${field} must be at most ${PASSWORD_MAX_LENGTH} characters`, field);
  }

  if (/\s/.test(value)) {
    throw badUserInput(`${field} cannot contain spaces`, field);
  }

  if (!/\p{Lu}/u.test(value)) {
    throw badUserInput(`${field} must contain at least one capital letter`, field);
  }

  // Anything that is not a letter or whitespace counts: digits, punctuation, symbols.
  if (!/[^\p{L}\s]/u.test(value)) {
    throw badUserInput(`${field} must contain at least one number or special character`, field);
  }

  return value;
}

export function validateLoginPassword(value: string, field = 'password'): string {
  if (value.length === 0) {
    throw badUserInput(`${field} cannot be empty`, field);
  }

  if (value.length > PASSWORD_MAX_LENGTH) {
    throw badUserInput(`${field} must be at most ${PASSWORD_MAX_LENGTH} characters`, field);
  }

  return value;
}

export function validatePhone(value: string, field = 'phoneNumber'): string {
  const phone = value.trim();

  if (phone.length < PHONE_MIN_LENGTH || phone.length > PHONE_MAX_LENGTH) {
    throw badUserInput(
      `${field} must be between ${PHONE_MIN_LENGTH} and ${PHONE_MAX_LENGTH} characters`,
      field
    );
  }

  return phone;
}

export function validatePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw badUserInput(`${field} must be a positive integer`, field);
  }

  return value;
}

export function validateCalendarDay(value: string, field: string): string {
  if (!isValidLocalDate(value)) {
    throw badUserInput(`${field} must be a valid date in YYYY-MM-DD format`, field);
  }

  return value;
}

export function validateDateRange(from: string, to: string): { from: string; to: string } {
  validateCalendarDay(from, 'from');
  validateCalendarDay(to, 'to');

  if (to < from) {
    throw badUserInput('to cannot be before from', 'to');
  }

  return { from, to };
}

export function validateBirthDate(value: string, field = 'birthDate'): string {
  const day = validateCalendarDay(value, field);

  if (day < EARLIEST_BIRTH_DATE) {
    throw badUserInput(`${field} cannot be before ${EARLIEST_BIRTH_DATE}`, field);
  }

  if (day > currentLocalDate()) {
    throw badUserInput(`${field} cannot be in the future`, field);
  }

  return day;
}

export function validateStudentInput(input: StudentInput): StudentInput {
  const allergies = (input.allergies ?? []).map((allergy) =>
    validateText(allergy, 'allergies', ALLERGY_MAX_LENGTH)
  );

  return {
    firstName: validateText(input.firstName, 'firstName', NAME_MAX_LENGTH),
    lastName: validateText(input.lastName, 'lastName', NAME_MAX_LENGTH),
    preferredName: validateOptionalText(input.preferredName, 'preferredName', NAME_MAX_LENGTH),
    birthDate: validateBirthDate(input.birthDate),
    allergies: [...new Set(allergies)],
    notes: validateOptionalText(input.notes, 'notes', NOTES_MAX_LENGTH),
  };
}

export function validatePersonName(value: string, field: string): string {
  return validateText(value, field, NAME_MAX_LENGTH);
}
