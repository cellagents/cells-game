const path = require('node:path');

module.exports = (_env, argv) => {
    const isProduction = (argv && argv.mode) === 'production';
    return {
        entry: {
            app: './src/client/js/app.ts',
            spectator: './src/client/js/spectator.ts',
            follow: './src/client/js/follow.ts',
            admin: './src/client/js/admin.ts'
        },
        mode: isProduction ? 'production' : 'development',
        resolve: {
            extensions: ['.ts', '.js']
        },
        output: {
            path: path.resolve(__dirname, 'bin/client/js'),
            filename: '[name].js'
        },
        devtool: false,
        module: {
            rules: [{
                test: /\.ts$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.client.json',
                        transpileOnly: !isProduction
                    }
                }
            }]
        }
    };
};
