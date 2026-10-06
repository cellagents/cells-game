const path = require('node:path');
const webpack = require('webpack');
const pkg = require('./package.json');

module.exports = (_env, argv) => {
    const isProduction = (argv && argv.mode) === 'production';
    return {
        entry: {
            lobby: './src/client/js/lobby.ts',
            player: './src/client/js/player.ts',
            spectator: './src/client/js/spectator.ts',
            follow: './src/client/js/follow.ts',
            managed: './src/client/js/managed.ts',
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
        plugins: [
            new webpack.DefinePlugin({
                __CELLS_VERSION__: JSON.stringify(pkg.version)
            })
        ],
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
