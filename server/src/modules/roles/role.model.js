import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z][a-z0-9_]{1,39}$/, 'Role key must be lower_snake_case'],
    },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
    // Code-default permissions already applied to this system role. New defaults introduced by later
    // releases are added once; permissions an admin removed are not re-added.
    defaultsApplied: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Role = mongoose.model('Role', roleSchema);
