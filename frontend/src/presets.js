export const CATEGORIES = [
  {
    id: 'degree',
    label: 'University degree',
    credentialType: "Bachelor's Degree",
    claimPlaceholder: 'Computer Science, graduated 2020',
    institutions: ['MIT', 'Stanford University', 'Harvard University', 'University of Oxford', 'National University of Singapore'],
  },
  {
    id: 'it',
    label: 'IT certificate',
    credentialType: 'AWS Certified Solutions Architect',
    claimPlaceholder: 'Associate level, cert ID ABC123',
    institutions: ['Amazon Web Services', 'Google Cloud', 'Microsoft', 'Cisco', 'CompTIA'],
  },
  {
    id: 'professional',
    label: 'Professional certificate',
    credentialType: 'PMP',
    claimPlaceholder: 'Project Management Professional, issued 2022, ID PMP-7781',
    institutions: ['Project Management Institute', 'PSI', 'Pearson VUE', 'Google'],
  },
  {
    id: 'other',
    label: 'Other',
    credentialType: '',
    claimPlaceholder: 'Certificate name, year issued, lookup id',
    institutions: [],
  },
];

export const CUSTOM_INSTITUTION = '__custom__';
