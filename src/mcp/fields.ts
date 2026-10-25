// The allowlist of queryable fields. Only these names ever reach SQL.
// Work email and date of birth are deliberately absent (PII; `age` covers the DOB use cases).
export type FieldType = 'text' | 'number' | 'date';

export interface Field {
  name: string;
  type: FieldType;
  description: string;
  // Few distinct values: describe_people_data lists them with counts.
  categorical?: boolean;
}

export const FIELDS: Field[] = [
  { name: 'full_name', type: 'text', description: 'Full name, e.g. "Alistair Finch"' },
  { name: 'job', type: 'text', description: 'Job title' },
  { name: 'team', type: 'text', categorical: true, description: 'Team / department' },
  { name: 'reports_to', type: 'text', categorical: true, description: 'Full name of the direct manager' },
  { name: 'office', type: 'text', categorical: true, description: 'Office name. One-to-one with city and country' },
  { name: 'city', type: 'text', categorical: true, description: 'City of the office' },
  { name: 'country', type: 'text', categorical: true, description: 'Country of the office' },
  { name: 'gender', type: 'text', categorical: true, description: 'Gender as recorded' },
  { name: 'contract_type', type: 'text', categorical: true, description: 'Contract type' },
  { name: 'work_status', type: 'text', categorical: true, description: 'active, or pending_arrival (hired, not started yet)' },
  { name: 'start_date', type: 'date', description: 'Start date at the company' },
  { name: 'age', type: 'number', description: 'Age in whole years, computed today from date of birth' },
  { name: 'tenure_years', type: 'number', description: 'Years since start date, computed today' },
  { name: 'salary_amount', type: 'number', description: 'Salary amount in its own currency and period. Not comparable across currencies' },
  { name: 'salary_currency', type: 'text', categorical: true, description: 'GBP, USD or ILS' },
  { name: 'salary_period', type: 'text', categorical: true, description: 'yearly, monthly or hourly' },
];
