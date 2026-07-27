/** Commit count on the current branch. 0 outside a git checkout. */
export declare function gitBuild(): number;
/** Short commit SHA, or 'dev' outside a git checkout. */
export declare function gitSha(): string;
