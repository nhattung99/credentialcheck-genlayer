export const CATEGORIES = [
  {
    id: 'degree',
    label: 'Bằng đại học',
    credentialType: "Bachelor's Degree",
    claimPlaceholder: 'Computer Science, graduated 2020',
    institutions: ['MIT', 'Stanford University', 'Harvard University', 'University of Oxford', 'National University of Singapore'],
  },
  {
    id: 'it',
    label: 'Chứng chỉ IT',
    credentialType: 'AWS Certified Solutions Architect',
    claimPlaceholder: 'Associate level, cert ID ABC123',
    institutions: ['Amazon Web Services', 'Google Cloud', 'Microsoft', 'Cisco', 'CompTIA'],
  },
  {
    id: 'professional',
    label: 'Chứng chỉ nghề',
    credentialType: 'PMP',
    claimPlaceholder: 'Project Management Professional, issued 2022, ID PMP-7781',
    institutions: ['Project Management Institute', 'PSI', 'Pearson VUE', 'Google'],
  },
  {
    id: 'other',
    label: 'Khác',
    credentialType: '',
    claimPlaceholder: 'Tên chứng chỉ, năm cấp, mã tra cứu',
    institutions: [],
  },
];

export const CUSTOM_INSTITUTION = '__custom__';
